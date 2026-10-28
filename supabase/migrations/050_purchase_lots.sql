begin;
alter table public.products add column tracks_purchase_lots boolean not null default false;
-- Snapshot the setting on new lines; toggling a product later must not rewrite history.
alter table public.purchase_order_lines add column lot_tracking_required boolean not null default false;
create sequence public.purchase_lot_number_seq;
create table public.purchase_lots(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 product_id uuid not null references public.products,quality_id uuid not null references public.product_qualities,
 lot_number text not null check(length(lot_number) between 1 and 80 and lot_number=upper(btrim(lot_number))),
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles,
 unique(organization_id,product_id,quality_id,lot_number),unique(id,organization_id,product_id,quality_id)
);
create table public.purchase_lot_receipts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 lot_id uuid not null,purchase_id uuid not null references public.purchase_orders,
 purchase_line_id uuid not null unique references public.purchase_order_lines,
 center_id uuid not null references public.centers,location_id uuid not null references public.locations,
 product_id uuid not null references public.products,quality_id uuid not null references public.product_qualities,
 received_quantity numeric(18,3) not null check(received_quantity>0),unit_purchase_price numeric(18,2) not null check(unit_purchase_price>=0),unit_of_measure text not null,
 received_at timestamptz not null,
 foreign key(lot_id,organization_id,product_id,quality_id) references public.purchase_lots(id,organization_id,product_id,quality_id)
);
create index purchase_lot_receipts_business_date on public.purchase_lot_receipts(organization_id,received_at desc,id);
create index purchase_lot_receipts_purchase on public.purchase_lot_receipts(purchase_id);
create index purchase_lot_receipts_lot on public.purchase_lot_receipts(lot_id);
alter table public.purchase_lots enable row level security;
alter table public.purchase_lot_receipts enable row level security;
revoke all on public.purchase_lots,public.purchase_lot_receipts from public,anon,authenticated;
grant select on public.purchase_lots,public.purchase_lot_receipts to authenticated;
create policy purchase_lots_read on public.purchase_lots for select to authenticated using(public.has_permission('purchases'));
create policy purchase_lot_receipts_read on public.purchase_lot_receipts for select to authenticated using(public.has_permission('purchases') and public.can_access_center(center_id));
do $$ declare definition text; t text; begin
 definition:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 definition:=replace(definition,'when p_table in (''purchase_order_lines'',''offline_purchase_requests'')',
 'when p_table in (''purchase_order_lines'',''offline_purchase_requests'',''purchase_lots'',''purchase_lot_receipts'')');
 if position('purchase_lot_receipts' in definition)=0 then raise exception 'Purchase module classification marker missing'; end if;
 execute definition;
 foreach t in array array['purchase_lots','purchase_lot_receipts'] loop
  execute format('create policy tenant_boundary on public.%I as restrictive for all to authenticated using(organization_id=(public.current_profile()).organization_id) with check(organization_id=(public.current_profile()).organization_id)',t);
  execute format('create policy business_operation_boundary on public.%I as restrictive for all to authenticated using(public.business_table_access(%L,to_jsonb(%I),false)) with check(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t,t,t);
  execute format('create policy business_delete_boundary on public.%I as restrictive for delete to authenticated using(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t);
  execute format('create trigger tenant_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write()',t);
  execute format('create trigger business_operation_guard before insert or update or delete on public.%I for each row execute function public.enforce_business_operation()',t);
 end loop;
end $$;

create function public.create_product_with_pricing(product_code text,product_name text,product_category_id uuid,product_unit text,global_price numeric,product_tracks_sacks boolean,product_tracks_purchase_lots boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; begin
 result:=public.create_product_with_pricing(product_code,product_name,product_category_id,product_unit,global_price,product_tracks_sacks);
 update public.products set tracks_purchase_lots=coalesce(product_tracks_purchase_lots,false) where id=result;
 return result;
end $$;
revoke all on function public.create_product_with_pricing(text,text,uuid,text,numeric,boolean,boolean) from public,anon;
grant execute on function public.create_product_with_pricing(text,text,uuid,text,numeric,boolean,boolean) to authenticated;

create function public.purchase_line_lot_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' then
  if exists(select 1 from public.purchase_orders where id=old.purchase_order_id and status<>'draft') then raise exception 'Confirmed purchase lines cannot be deleted'; end if;
  return old;
 end if;
 if tg_op='INSERT' then
  select tracks_purchase_lots into new.lot_tracking_required from public.products where id=new.product_id;
  return new;
 end if;
 if exists(select 1 from public.purchase_orders where id=old.purchase_order_id and status<>'draft') then
  if row(new.purchase_order_id,new.product_id,new.quality_id,new.location_id,new.quantity,new.actual_price,new.lot_tracking_required)
   is distinct from row(old.purchase_order_id,old.product_id,old.quality_id,old.location_id,old.quantity,old.actual_price,old.lot_tracking_required)
   then raise exception 'Confirmed purchase lot assignments and receipt dimensions are immutable'; end if;
 else
  select tracks_purchase_lots into new.lot_tracking_required from public.products where id=new.product_id;
 end if;
 return new;
end $$;
revoke all on function public.purchase_line_lot_guard() from public,anon,authenticated;
create trigger purchase_line_lot_guard before insert or update or delete on public.purchase_order_lines for each row execute function public.purchase_line_lot_guard();
create function public.snapshot_confirming_purchase_lots() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.status='draft' and new.status='confirmed' then
  update public.purchase_order_lines l set lot_tracking_required=p.tracks_purchase_lots from public.products p where l.purchase_order_id=new.id and p.id=l.product_id;
 end if; return new;
end $$;
revoke all on function public.snapshot_confirming_purchase_lots() from public,anon,authenticated;
create trigger snapshot_confirming_purchase_lots before update of status on public.purchase_orders for each row execute function public.snapshot_confirming_purchase_lots();

create function public.protect_purchase_lot_history() returns trigger language plpgsql security definer set search_path=public as $$
declare source record; begin
 if tg_op<>'INSERT' then raise exception 'Purchase lot history is immutable'; end if;
 if tg_table_name='purchase_lot_receipts' then
  select l.*,o.organization_id,o.center_id,o.confirmed_at,o.status,p.unit_of_measure into source from public.purchase_order_lines l join public.purchase_orders o on o.id=l.purchase_order_id join public.products p on p.id=l.product_id where l.id=new.purchase_line_id;
  if not found then raise exception 'Purchase receipt line not found'; end if;
  if source.status<>'confirmed' or not source.lot_tracking_required or row(new.organization_id,new.purchase_id,new.center_id,new.location_id,new.product_id,new.quality_id,new.received_quantity,new.unit_purchase_price,new.received_at,new.unit_of_measure)
    is distinct from row(source.organization_id,source.purchase_order_id,source.center_id,source.location_id,source.product_id,source.quality_id,source.quantity,source.actual_price,source.confirmed_at,source.unit_of_measure)
    then raise exception 'Lot receipt must match the confirmed purchase line'; end if;
 end if; return new;
end $$;
revoke all on function public.protect_purchase_lot_history() from public,anon,authenticated;
create trigger purchase_lot_identity_guard before insert or update or delete on public.purchase_lots for each row execute function public.protect_purchase_lot_history();
create trigger purchase_lot_receipt_guard before insert or update or delete on public.purchase_lot_receipts for each row execute function public.protect_purchase_lot_history();

create function public.validate_purchase_lot_assignments() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.purchase_orders o join public.purchase_order_lines l on l.purchase_order_id=o.id
  where o.id=new.id and o.status='confirmed' and l.lot_tracking_required
  and not exists(select 1 from public.purchase_lot_receipts r where r.purchase_line_id=l.id)) then
  raise exception 'Lot-tracked purchases must be confirmed with purchase lot assignments';
 end if; return null;
end $$;
revoke all on function public.validate_purchase_lot_assignments() from public,anon,authenticated;
create constraint trigger purchase_requires_lot_receipts after insert or update of status on public.purchase_orders deferrable initially deferred for each row execute function public.validate_purchase_lot_assignments();

create function public.confirm_queued_purchase_with_lots(
 p_request uuid,target_center uuid,target_supplier uuid,purchase_notes text,purchase_lines jsonb,payment_allocations jsonb,
 p_labor_session uuid default null,p_load_count integer default 0,p_detailed boolean default false,
 purchase_sack_counts jsonb default '[]'::jsonb,use_cash_farmer boolean default false
) returns table(purchase_id uuid,purchase_number text,purchase_total numeric,paid_amount numeric,credit_balance numeric,payment_status text)
language plpgsql security definer set search_path=public as $$
declare result record; posted record; choice jsonb; mode text; lot uuid; number text; org uuid; existing uuid;
begin
 perform public.assert_business_operation('purchases');
 if auth.uid() is null or p_request is null or not public.has_permission('purchases') or not public.can_access_center(target_center) then raise exception 'Purchase access and request ID required'; end if;
 org:=(public.current_profile()).organization_id;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select r.purchase_id into existing from public.offline_purchase_requests r where r.request_id=p_request and r.created_by=auth.uid() and r.center_id=target_center;
 if existing is not null then
  return query select o.id,o.po_number,o.total_amount,o.paid_amount,o.credit_balance,o.payment_status from public.purchase_orders o where o.id=existing and o.organization_id=org;
  return;
 end if;
 select * into result from public.confirm_queued_purchase_with_labor(p_request,target_center,target_supplier,purchase_notes,purchase_lines,payment_allocations,p_labor_session,p_load_count,p_detailed,purchase_sack_counts,use_cash_farmer);
 if (select count(*) from public.purchase_order_lines where purchase_order_id=result.purchase_id)<>jsonb_array_length(purchase_lines) then raise exception 'Lot rows do not match purchase rows'; end if;
 for posted in select l.*,row_number() over(order by l.entry_order) row_no,o.confirmed_at,o.center_id,p.unit_of_measure from public.purchase_order_lines l join public.purchase_orders o on o.id=l.purchase_order_id join public.products p on p.id=l.product_id where l.purchase_order_id=result.purchase_id order by l.entry_order loop
  choice:=purchase_lines->((posted.row_no-1)::integer)->'lot_selection';
  if not posted.lot_tracking_required then
   if choice is not null and choice<>'null'::jsonb then raise exception 'Lot tracking is disabled for a selected product; review its lot choice'; end if;
   continue;
  end if;
  mode:=coalesce(choice->>'mode','auto');lot:=null;
  if mode='existing' then
   select id into lot from public.purchase_lots where id=(choice->>'lot_id')::uuid and organization_id=org and product_id=posted.product_id and quality_id=posted.quality_id;
   if lot is null then raise exception 'Selected lot does not belong to this business, product and quality'; end if;
  elsif mode in ('auto','number') then
   if mode='number' then
    number:=upper(btrim(coalesce(choice->>'number','')));
    if length(number) not between 1 and 80 then raise exception 'Enter a lot number of 1 to 80 characters'; end if;
    insert into public.purchase_lots(organization_id,product_id,quality_id,lot_number,created_by) values(org,posted.product_id,posted.quality_id,number,auth.uid()) on conflict(organization_id,product_id,quality_id,lot_number) do nothing returning id into lot;
    if lot is null then select id into lot from public.purchase_lots where organization_id=org and product_id=posted.product_id and quality_id=posted.quality_id and lot_number=number; end if;
   else
    while lot is null loop
     number:='LOT-'||to_char(now() at time zone 'Asia/Colombo','YYYYMMDD')||'-'||lpad(nextval('public.purchase_lot_number_seq')::text,10,'0');
     insert into public.purchase_lots(organization_id,product_id,quality_id,lot_number,created_by) values(org,posted.product_id,posted.quality_id,number,auth.uid()) on conflict(organization_id,product_id,quality_id,lot_number) do nothing returning id into lot;
    end loop;
   end if;
  else raise exception 'Invalid lot selection mode'; end if;
  insert into public.purchase_lot_receipts(organization_id,lot_id,purchase_id,purchase_line_id,center_id,location_id,product_id,quality_id,received_quantity,unit_purchase_price,received_at,unit_of_measure)
   values(org,lot,result.purchase_id,posted.id,posted.center_id,posted.location_id,posted.product_id,posted.quality_id,posted.quantity,posted.actual_price,posted.confirmed_at,posted.unit_of_measure);
 end loop;
 return query select result.purchase_id,result.purchase_number,result.purchase_total,result.paid_amount,result.credit_balance,result.payment_status;
end $$;
revoke all on function public.confirm_queued_purchase_with_lots(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer,boolean,jsonb,boolean) from public,anon;
grant execute on function public.confirm_queued_purchase_with_lots(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer,boolean,jsonb,boolean) to authenticated;
commit;
