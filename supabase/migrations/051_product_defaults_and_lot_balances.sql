begin;
lock table public.stock_movements in share row exclusive mode;
-- Quality default_price already means default purchase price. Do not duplicate it.
-- NULL sales default preserves the previous remembered-price behavior until configured.
alter table public.products add column default_sales_price numeric(18,2) check(default_sales_price>=0);
alter table public.products add column costing_method text not null default 'AVCO' check(costing_method in ('FIFO','AVCO'));
comment on column public.products.costing_method is 'Future policy only: not applied to valuation. Existing movement-value average calculations remain unchanged.';

create function public.create_product_with_pricing(product_code text,product_name text,product_category_id uuid,product_unit text,global_price numeric,product_tracks_sacks boolean,product_tracks_purchase_lots boolean,product_default_sales_price numeric,product_costing_method text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; begin
 result:=public.create_product_with_pricing(product_code,product_name,product_category_id,product_unit,global_price,product_tracks_sacks,product_tracks_purchase_lots);
 update public.products set default_sales_price=product_default_sales_price,costing_method=product_costing_method where id=result;
 return result;
end $$;
revoke all on function public.create_product_with_pricing(text,text,uuid,text,numeric,boolean,boolean,numeric,text) from public,anon;
grant execute on function public.create_product_with_pricing(text,text,uuid,text,numeric,boolean,boolean,numeric,text) to authenticated;

-- Atomic product/quality edits use existing product_edit permission, including users
-- allowed to edit products but not globally administer quality/center price tables.
create function public.edit_product_defaults(p_product uuid,p_code text,p_name text,p_category uuid,p_unit text,p_sacks boolean,p_lots boolean,p_sales numeric,p_method text,p_prices jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare org uuid; price jsonb; begin
 perform public.assert_business_operation('masters');
 if not public.is_admin() and not (public.has_permission('masters') and public.has_permission('product_edit')) then raise exception 'Product editing access required'; end if;
 org:=(public.current_profile()).organization_id;
 perform 1 from public.products where id=p_product and organization_id=org for update;
 if not found then raise exception 'Product not found'; end if;
 if p_category is not null and not exists(select 1 from public.product_categories where id=p_category and organization_id=org and is_active) then raise exception 'Invalid category'; end if;
 update public.products set code=upper(btrim(p_code)),name=btrim(p_name),category_id=p_category,category=(select name from public.product_categories where id=p_category),unit_of_measure=p_unit,tracks_sacks=p_sacks,tracks_purchase_lots=p_lots,default_sales_price=p_sales,costing_method=p_method where id=p_product;
 if jsonb_typeof(p_prices) is distinct from 'array' then raise exception 'Quality prices required'; end if;
 for price in select value from jsonb_array_elements(p_prices) loop
  update public.product_qualities set default_price=(price->>'price')::numeric where id=(price->>'quality_id')::uuid and product_id=p_product;
  if not found then raise exception 'Invalid product quality'; end if;
 end loop;
end $$;
revoke all on function public.edit_product_defaults(uuid,text,text,uuid,text,boolean,boolean,numeric,text,jsonb) from public,anon;
grant execute on function public.edit_product_defaults(uuid,text,text,uuid,text,boolean,boolean,numeric,text,jsonb) to authenticated;

-- Business-wide price memory, not lot receipt costs or center-specific valuation.
create function public.latest_purchase_prices() returns table(product_id uuid,quality_id uuid,price numeric,confirmed_at timestamptz,purchase_id uuid,line_id uuid)
language plpgsql stable security definer set search_path=public as $$
begin
 perform public.assert_business_operation('purchases');
 if not public.has_permission('purchases') then raise exception 'Purchase access required'; end if;
 return query select distinct on(l.product_id,l.quality_id) l.product_id,l.quality_id,l.actual_price,o.confirmed_at,o.id,l.id
 from public.purchase_orders o join public.purchase_order_lines l on l.purchase_order_id=o.id
 where o.organization_id=(public.current_profile()).organization_id and o.status='confirmed' and o.confirmed_at is not null
 order by l.product_id,l.quality_id,o.confirmed_at desc,o.id desc,l.entry_order desc,l.id desc;
end $$;
revoke all on function public.latest_purchase_prices() from public,anon;
grant execute on function public.latest_purchase_prices() to authenticated;

-- Physical allocation ledger; deliberately independent of movement unit_cost.
-- No historical receipt-to-movement matches are guessed during migration.
create table public.stock_lot_allocations(
 id bigint generated always as identity primary key,
 movement_id uuid not null references public.stock_movements,
 lot_id uuid references public.purchase_lots,
 quantity numeric(18,3) not null check(quantity<>0),
 source_allocation_id bigint references public.stock_lot_allocations,
 document_line_id uuid,
 receipt_id uuid unique references public.purchase_lot_receipts
);
create index stock_lot_allocations_movement on public.stock_lot_allocations(movement_id);
create index stock_lot_allocations_lot on public.stock_lot_allocations(lot_id);
create index stock_lot_allocations_source on public.stock_lot_allocations(source_allocation_id);
create index stock_lot_allocations_document on public.stock_lot_allocations(document_line_id);
create index stock_movements_lot_dimensions on public.stock_movements(organization_id,product_id,quality_id,location_id);
create index stock_movements_lot_reference on public.stock_movements(reference_type,reference_id,product_id,quality_id);
insert into public.stock_lot_allocations(movement_id,quantity)
 select id,case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity else -quantity end from public.stock_movements;
alter table public.stock_lot_allocations enable row level security;
revoke all on public.stock_lot_allocations from public,anon,authenticated;
grant select on public.stock_lot_allocations to authenticated;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 definition:=replace(definition,'when p_table=''stock_movements'' then','when p_table in (''stock_movements'',''stock_lot_allocations'') then');
 if position('stock_lot_allocations' in definition)=0 then raise exception 'Inventory module classification marker missing'; end if;
 execute definition;
end $$;
create policy tenant_boundary on public.stock_lot_allocations as restrictive for all to authenticated
 using(public.tenant_row_organization('public.stock_lot_allocations'::regclass,to_jsonb(stock_lot_allocations))=(public.current_profile()).organization_id)
 with check(public.tenant_row_organization('public.stock_lot_allocations'::regclass,to_jsonb(stock_lot_allocations))=(public.current_profile()).organization_id);
create policy business_operation_boundary on public.stock_lot_allocations as restrictive for all to authenticated
 using(public.business_table_access('stock_lot_allocations',to_jsonb(stock_lot_allocations),false))
 with check(public.business_table_access('stock_lot_allocations',to_jsonb(stock_lot_allocations),true));
create policy business_delete_boundary on public.stock_lot_allocations as restrictive for delete to authenticated
 using(public.business_table_access('stock_lot_allocations',to_jsonb(stock_lot_allocations),true));
create trigger tenant_write_guard before insert or update or delete on public.stock_lot_allocations for each row execute function public.enforce_tenant_write();
create trigger business_operation_guard before insert or update or delete on public.stock_lot_allocations for each row execute function public.enforce_business_operation();
create policy stock_lot_allocation_read on public.stock_lot_allocations for select to authenticated using(
 public.has_permission('stock') and public.business_table_access('stock_movements') and exists(
 select 1 from public.stock_movements m where m.id=movement_id and m.organization_id=(public.current_profile()).organization_id and public.can_access_center(m.center_id)));

-- Serialize each physical stock dimension within its location. Existing confirmation
-- RPCs keep their request-id guards and transaction boundaries.
create function public.lock_lot_stock_dimension() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op<>'INSERT' then raise exception 'Posted stock movements are immutable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||new.product_id::text||new.quality_id::text||new.location_id::text,51));
 return new;
end $$;
create trigger lot_stock_dimension_lock before insert or update or delete on public.stock_movements for each row execute function public.lock_lot_stock_dimension();

create function public.allocate_stock_lots() returns trigger language plpgsql security definer set search_path=public as $$
declare remaining numeric:=new.quantity; take numeric; item record; original uuid; original_type text; incoming boolean; source_move uuid; document_line uuid; reversed_line uuid;
begin
 incoming:=new.movement_type in ('purchase_in','transfer_in','adjustment_in');
 if new.reference_type in ('sales_return','purchase_return') then
  select bill_id,case when bill_type='sale' then 'sales_order' else 'purchase_order' end into original,original_type from public.bill_returns where id=new.reference_id;
  select l.id,l.source_line_id into document_line,reversed_line from public.bill_return_lines l
   where l.return_id=new.reference_id and l.location_id=new.location_id and l.product_id=new.product_id and l.quality_id=new.quality_id and l.quantity=new.quantity and l.unit_cost=new.unit_cost
    and not exists(select 1 from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id where m.reference_id=new.reference_id and m.reference_type=new.reference_type and a.document_line_id=l.id)
   order by l.id limit 1;
  if document_line is null then raise exception 'Return source line missing'; end if;
 elsif new.reference_type in ('sale_cancellation','purchase_cancellation') then
  select bill_id,case when bill_type='sale' then 'sales_order' else 'purchase_order' end into original,original_type from public.bill_cancel_requests where id=new.reference_id;
 elsif new.movement_type='transfer_in' and new.reference_type='stock_transfer' then
  select m.id into source_move from public.stock_movements m where m.reference_type='stock_transfer' and m.reference_id=new.reference_id and m.movement_type='transfer_out' and m.product_id=new.product_id and m.quality_id=new.quality_id
   and not exists(select 1 from public.stock_lot_allocations a join public.stock_lot_allocations s on s.id=a.source_allocation_id where s.movement_id=m.id)
   order by m.created_at,m.id limit 1;
  if source_move is null then raise exception 'Transfer lot source missing'; end if;
 end if;
 if original is not null or source_move is not null then
  -- Reverse the recorded source allocations, never rerun oldest-lot selection.
  for item in select a.id,a.lot_id,abs(a.quantity)-coalesce((select sum(abs(r.quantity)) from public.stock_lot_allocations r where r.source_allocation_id=a.id),0) available
   from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id
   where m.organization_id=new.organization_id and m.product_id=new.product_id and m.quality_id=new.quality_id
    and ((source_move is not null and m.id=source_move) or (source_move is null and m.reference_id=original and m.reference_type=original_type and m.location_id=new.location_id and m.center_id=new.center_id and (reversed_line is null or a.document_line_id=reversed_line or a.document_line_id is null)))
   order by a.id loop
   take:=least(remaining,item.available); if take<=0 then continue; end if;
   if not incoming and take>(select coalesce(sum(a.quantity),0) from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id where m.organization_id=new.organization_id and m.location_id=new.location_id and m.product_id=new.product_id and m.quality_id=new.quality_id and a.lot_id is not distinct from item.lot_id) then raise exception 'Original purchase lot stock has been used; cannot reverse unrelated lots'; end if;
   insert into public.stock_lot_allocations(movement_id,lot_id,quantity,source_allocation_id,document_line_id) values(new.id,item.lot_id,case when incoming then take else -take end,item.id,document_line);
   remaining:=remaining-take; exit when remaining=0;
  end loop;
  if remaining<>0 then raise exception 'Original lot allocation cannot cover reversal or transfer'; end if;
 elsif incoming then
  -- Purchases are assigned when their immutable receipts are inserted later in
  -- this same transaction. Positive adjustments remain explicitly unassigned.
  insert into public.stock_lot_allocations(movement_id,quantity) values(new.id,remaining);
 else
  if new.reference_type='sales_order' then
   select l.id into document_line from public.sales_order_lines l where l.sales_order_id=new.reference_id and l.location_id=new.location_id and l.product_id=new.product_id and l.quality_id=new.quality_id and l.quantity=new.quantity and l.unit_cost=new.unit_cost
    and not exists(select 1 from public.stock_lot_allocations a where a.document_line_id=l.id) order by l.id limit 1;
   if document_line is null then raise exception 'Sale source line missing'; end if;
  end if;
  for item in select a.lot_id,sum(a.quantity) available,
    case when a.lot_id is null then '-infinity'::timestamptz else (select min(r.received_at) from public.purchase_lot_receipts r where r.lot_id=a.lot_id) end received
   from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id
   where m.organization_id=new.organization_id and m.location_id=new.location_id and m.product_id=new.product_id and m.quality_id=new.quality_id
   group by a.lot_id having sum(a.quantity)>0 order by received,a.lot_id nulls first loop
   take:=least(remaining,item.available);
   insert into public.stock_lot_allocations(movement_id,lot_id,quantity,document_line_id) values(new.id,item.lot_id,-take,document_line);
   remaining:=remaining-take; exit when remaining=0;
  end loop;
  if remaining<>0 then raise exception 'Insufficient physical lot stock'; end if;
 end if;
 return new;
end $$;
create trigger allocate_stock_lots after insert on public.stock_movements for each row execute function public.allocate_stock_lots();

create function public.assign_purchase_receipt_lot() returns trigger language plpgsql security definer set search_path=public as $$
declare allocation bigint; begin
 select a.id into allocation from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id
 where m.organization_id=new.organization_id and m.center_id=new.center_id and m.location_id=new.location_id and m.product_id=new.product_id and m.quality_id=new.quality_id
  and m.reference_type='purchase_order' and m.reference_id=new.purchase_id and m.movement_type='purchase_in' and m.quantity=new.received_quantity and m.unit_cost=new.unit_purchase_price
  and a.receipt_id is null and a.lot_id is null and a.quantity=new.received_quantity order by a.id limit 1 for update of a;
 if allocation is null then raise exception 'Receipt stock movement missing'; end if;
 update public.stock_lot_allocations set lot_id=new.lot_id,receipt_id=new.id,document_line_id=new.purchase_line_id where id=allocation;
 return new;
end $$;
create trigger assign_purchase_receipt_lot after insert on public.purchase_lot_receipts for each row execute function public.assign_purchase_receipt_lot();

-- Stock users do not need purchase-module permissions to inspect on-hand lots.
create function public.stock_lot_balances() returns table(center_id uuid,location_id uuid,product_id uuid,quality_id uuid,lot_id uuid,lot_number text,available_quantity numeric)
language plpgsql stable security definer set search_path=public as $$
begin
 perform public.assert_business_operation('inventory');
 if not public.has_permission('stock') then raise exception 'Stock access required'; end if;
 return query select m.center_id,m.location_id,m.product_id,m.quality_id,a.lot_id,coalesce(l.lot_number,'Unassigned / Legacy'),sum(a.quantity)
 from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id left join public.purchase_lots l on l.id=a.lot_id
 where m.organization_id=(public.current_profile()).organization_id and public.can_access_center(m.center_id)
 group by m.center_id,m.location_id,m.product_id,m.quality_id,a.lot_id,l.lot_number having sum(a.quantity)<>0
 order by m.product_id,m.quality_id,m.center_id,m.location_id,l.lot_number nulls first;
end $$;
revoke all on function public.lock_lot_stock_dimension(),public.allocate_stock_lots(),public.assign_purchase_receipt_lot() from public,anon,authenticated;
revoke all on function public.stock_lot_balances() from public,anon;
grant execute on function public.stock_lot_balances() to authenticated;
commit;
