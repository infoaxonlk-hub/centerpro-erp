begin;
create or replace function public.confirm_queued_purchase_with_lots(
 p_request uuid,target_center uuid,target_supplier uuid,purchase_notes text,purchase_lines jsonb,payment_allocations jsonb,
 p_labor_session uuid default null,p_load_count integer default 0,p_detailed boolean default false,
 purchase_sack_counts jsonb default '[]'::jsonb,use_cash_farmer boolean default false
) returns table(purchase_id uuid,purchase_number text,purchase_total numeric,paid_amount numeric,credit_balance numeric,payment_status text)
language plpgsql security definer set search_path=public as $$
declare result record; posted record; choice jsonb; mode text; lot uuid; number text; org uuid; existing uuid; product_lots jsonb:='{}'::jsonb;
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
 -- Each product has a single quality and lot choice across its individual weighings.
 if exists(select 1 from jsonb_array_elements(purchase_lines) e group by e->>'product_id'
  having count(distinct e->>'quality_id')>1 or count(distinct case coalesce(e->'lot_selection'->>'mode','auto')
   when 'auto' then 'auto'
   when 'number' then 'number:'||upper(btrim(coalesce(e->'lot_selection'->>'number','')))
   when 'existing' then 'existing:'||coalesce(e->'lot_selection'->>'lot_id','')
   else (e->'lot_selection')::text end)>1) then raise exception 'All weighings of a product must use one quality and one lot';end if;
 select * into result from public.confirm_queued_purchase_with_labor(p_request,target_center,target_supplier,purchase_notes,purchase_lines,payment_allocations,p_labor_session,p_load_count,p_detailed,purchase_sack_counts,use_cash_farmer);
 if (select count(*) from public.purchase_order_lines where purchase_order_id=result.purchase_id)<>jsonb_array_length(purchase_lines) then raise exception 'Lot rows do not match purchase rows'; end if;
 for posted in select l.*,row_number() over(order by l.entry_order) row_no,o.confirmed_at,o.center_id,p.unit_of_measure from public.purchase_order_lines l join public.purchase_orders o on o.id=l.purchase_order_id join public.products p on p.id=l.product_id where l.purchase_order_id=result.purchase_id order by l.entry_order loop
  choice:=purchase_lines->((posted.row_no-1)::integer)->'lot_selection';
  if not posted.lot_tracking_required then
   if choice is not null and choice<>'null'::jsonb then raise exception 'Lot tracking is disabled for a selected product; review its lot choice'; end if;
   continue;
  end if;
  mode:=coalesce(choice->>'mode','auto');lot:=null;
  if product_lots ? posted.product_id::text then
   lot:=(product_lots->>posted.product_id::text)::uuid;
  elsif mode='existing' then
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
  product_lots:=jsonb_set(product_lots,array[posted.product_id::text],to_jsonb(lot));
  insert into public.purchase_lot_receipts(organization_id,lot_id,purchase_id,purchase_line_id,center_id,location_id,product_id,quality_id,received_quantity,unit_purchase_price,received_at,unit_of_measure)
   values(org,lot,result.purchase_id,posted.id,posted.center_id,posted.location_id,posted.product_id,posted.quality_id,posted.quantity,posted.actual_price,posted.confirmed_at,posted.unit_of_measure);
 end loop;
 return query select result.purchase_id,result.purchase_number,result.purchase_total,result.paid_amount,result.credit_balance,result.payment_status;
end $$;
revoke all on function public.confirm_queued_purchase_with_lots(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer,boolean,jsonb,boolean) from public,anon;
grant execute on function public.confirm_queued_purchase_with_lots(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer,boolean,jsonb,boolean) to authenticated;

-- Extend 054's guards without changing any process permission or historical row.
do $$ declare definition text; old_check text; begin
 definition:=pg_get_functiondef('public.guard_product_process_line()'::regprocedure);
 old_check:='l.product_id=new.product_id and l.id<>new.id';
 if position(old_check in definition)=0 then raise exception 'Purchase line guard marker missing';end if;
 definition:=replace(definition,old_check,old_check||' and l.quality_id<>new.quality_id');
 definition:=replace(definition,'Only one lot and total weighing per product is allowed in a purchase order','All weighings of a product must use one quality and one lot');
 execute definition;
 definition:=pg_get_functiondef('public.guard_product_process_confirmation()'::regprocedure);
 if position('group by product_id having count(*)>1' in definition)=0 then raise exception 'Purchase confirmation guard marker missing';end if;
 definition:=replace(definition,'group by product_id having count(*)>1','group by product_id having count(distinct quality_id)>1');
 definition:=replace(definition,'Only one lot and total weighing per product is allowed in a purchase order','All weighings of a product must use one quality and one lot');
 execute definition;
end $$;

-- Deferred until the RPC has assigned every weighing to its shared product lot.
-- The existing required-receipt guard also prevents bypass through older RPCs.
create or replace function public.validate_purchase_lot_assignments() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status<>'confirmed' then return null;end if;
 if exists(select 1 from public.purchase_orders o join public.purchase_order_lines l on l.purchase_order_id=o.id
  where o.id=new.id and o.status='confirmed' and l.lot_tracking_required
  and not exists(select 1 from public.purchase_lot_receipts r where r.purchase_line_id=l.id)) then
  raise exception 'Lot-tracked purchases must be confirmed with purchase lot assignments';
 end if;
 if exists(select 1 from public.purchase_lot_receipts r where r.purchase_id=new.id group by r.product_id having count(distinct r.lot_id)>1) then
  raise exception 'All weighings of a product must use one quality and one lot';
 end if;
 return null;
end $$;
notify pgrst,'reload schema';
commit;
