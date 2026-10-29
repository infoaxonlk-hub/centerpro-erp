begin;
-- Follow-up to the supplied 052: keep already-applied copies intact.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 definition:=replace(definition,'then array[''manufacturing''] else array[''inventory''] end;', 'then array[''inventory'',''manufacturing''] else array[''inventory''] end;');
 definition:=replace(definition,'then array[''manufacturing''] else array[''purchases'',''manufacturing''] end;', 'then array[''inventory'',''manufacturing'',''purchases''] else array[''inventory'',''purchases'',''manufacturing''] end;');
 execute definition;
 definition:=pg_get_functiondef('public.platform_grant_business_admin_access(uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,'when ''inventory'' then array[''stock'']','when ''inventory'' then array[''stock''] when ''manufacturing'' then array[''manufacturing'']');
 execute definition;
 definition:=pg_get_functiondef('public.allocate_stock_lots()'::regprocedure);
 definition:=replace(definition,'(select min(r.received_at) from public.purchase_lot_receipts r where r.lot_id=a.lot_id)',
 'least((select min(r.received_at) from public.purchase_lot_receipts r where r.lot_id=a.lot_id),(select l.created_at from public.purchase_lots l where l.id=a.lot_id))');
 execute definition;
end $$;

create or replace function public.stock_lot_balances()
returns table(center_id uuid,location_id uuid,product_id uuid,quality_id uuid,lot_id uuid,lot_number text,available_quantity numeric)
language plpgsql stable security definer set search_path=public as $$
begin
 if public.has_permission('stock') and public.business_table_access('stock_movements','{"reference_type":"purchase_order"}'::jsonb) then perform public.assert_business_operation('inventory');
 else
  perform public.assert_business_operation('manufacturing');
  if not public.has_permission('manufacturing') and not public.has_permission('stock') then raise exception 'Stock access required'; end if;
 end if;
 return query select m.center_id,m.location_id,m.product_id,m.quality_id,a.lot_id,coalesce(l.lot_number,'Unassigned / Legacy'),sum(a.quantity)
 from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id left join public.purchase_lots l on l.id=a.lot_id
 where m.organization_id=(public.current_profile()).organization_id and public.can_access_center(m.center_id)
 group by m.center_id,m.location_id,m.product_id,m.quality_id,a.lot_id,l.lot_number having sum(a.quantity)<>0
 order by m.product_id,m.quality_id,m.center_id,m.location_id,l.lot_number nulls first;
end $$;

alter table public.manufacturing_order_inputs add column sack_count integer not null default 0 check(sack_count>=0);
alter table public.manufacturing_order_outputs add column sack_count integer not null default 0 check(sack_count>=0);
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.save_manufacturing_order(uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'org:=(public.current_profile()).organization_id; actor:=auth.uid();', $guard$
 org:=(public.current_profile()).organization_id; actor:=auth.uid();
 if p_order_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,52));
  if exists(select 1 from public.manufacturing_orders m where m.id=p_order_id and m.organization_id=org and not public.can_access_center(m.center_id)) then raise exception 'Production center access denied';end if;
  if exists(select 1 from public.manufacturing_orders m where m.id=p_order_id and m.organization_id=org and m.status='completed') then
   return query select m.id,m.order_number from public.manufacturing_orders m where m.id=p_order_id and m.organization_id=org;return;
  end if;
 end if;
 $guard$);
 definition:=replace(definition,'if p_order_id is null then', 'if p_order_id is null or not exists(select 1 from public.manufacturing_orders m where m.id=p_order_id) then');
 definition:=replace(definition,'insert into public.manufacturing_orders(organization_id,', 'insert into public.manufacturing_orders(id,organization_id,');
 definition:=replace(definition,'values(org,n,center,loc,', 'values(coalesce(p_order_id,gen_random_uuid()),org,n,center,loc,');
 definition:=replace(definition,'lot_number,quantity,unit_of_measure)', 'lot_number,quantity,unit_of_measure,sack_count)');
 definition:=replace(definition,'(input->>''quantity'')::numeric,p.unit_of_measure from', '(input->>''quantity'')::numeric,p.unit_of_measure,coalesce((input->>''sack_count'')::integer,0) from');
 definition:=replace(definition,'packaging_quality_id,cost_share_percent)', 'packaging_quality_id,cost_share_percent,sack_count)');
 definition:=replace(definition,'coalesce((output->>''cost_share_percent'')::numeric,0)', 'coalesce((output->>''cost_share_percent'')::numeric,0),coalesce((output->>''sack_count'')::integer,0)');
 execute definition;
end $$;

create or replace function public.complete_manufacturing_order(p_order_id uuid)
returns table(order_id uuid,order_number text,status text,total_cost numeric)
language plpgsql security definer set search_path=public as $$
declare v_order public.manufacturing_orders; item record; produced record; v_available numeric; v_value numeric; v_lot_available numeric; v_unit numeric; v_line_cost numeric; v_material numeric:=0; v_operation numeric; v_total numeric; v_input numeric; v_weight numeric; v_shares numeric; v_allocated numeric:=0; v_move uuid; v_lot uuid; v_number text; v_origin text; v_count integer; v_index integer:=0;
begin
 perform public.assert_business_operation('manufacturing');
 if not public.has_permission('manufacturing') and not public.has_permission('stock') then raise exception 'Manufacturing access required'; end if;
 select m.* into v_order from public.manufacturing_orders m where m.id=p_order_id and m.organization_id=(public.current_profile()).organization_id for update;
 if not found then raise exception 'Production order not found'; end if;
 if not public.can_access_center(v_order.center_id) then raise exception 'You cannot access this stock center'; end if;
 if v_order.status='completed' then return query select v_order.id,v_order.order_number,v_order.status,v_order.total_cost;return;end if;
 if v_order.status<>'draft' then raise exception 'Only draft production orders can be completed';end if;
 perform 1 from public.centers where id=v_order.center_id and is_active for update;
 if not found or not exists(select 1 from public.locations where id=v_order.location_id and center_id=v_order.center_id and is_active) then raise exception 'Active production center and location required';end if;
 if not exists(select 1 from public.manufacturing_order_inputs i where i.order_id=v_order.id) or not exists(select 1 from public.manufacturing_order_outputs x where x.order_id=v_order.id) then raise exception 'Add production inputs and outputs before completing';end if;
 if exists(select 1 from public.manufacturing_order_inputs i join public.products p on p.id=i.product_id join public.product_qualities q on q.id=i.quality_id where i.order_id=v_order.id and (not p.is_active or not q.is_active))
 or exists(select 1 from public.manufacturing_order_outputs x join public.products p on p.id=x.product_id join public.product_qualities q on q.id=x.quality_id where x.order_id=v_order.id and (not p.is_active or not q.is_active)) then raise exception 'Production products and qualities must be active';end if;
 if v_order.process_type='packing' then
  if exists(select 1 from public.manufacturing_order_inputs i join public.product_qualities q on q.id=i.quality_id where i.order_id=v_order.id and (i.input_kind not in ('bulk_rice','packaging') or (i.input_kind='bulk_rice' and lower(trim(q.name))<>lower(trim(v_order.rice_variety))))) then raise exception 'Packing inputs must use the selected rice variety';end if;
  select coalesce(sum(i.quantity),0) into v_input from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.input_kind='bulk_rice';
  select coalesce(sum(x.quantity*x.package_size_kg),0) into v_weight from public.manufacturing_order_outputs x where x.order_id=v_order.id;
  if v_input<=0 or abs(v_input-v_weight)>0.001 then raise exception 'Bulk rice quantity must equal the total weight of the selected packages';end if;
  if exists(select 1 from public.manufacturing_order_outputs x join public.product_qualities q on q.id=x.quality_id where x.order_id=v_order.id and (x.output_kind<>'packed' or x.quantity<>trunc(x.quantity) or lower(trim(q.name))<>lower(trim(v_order.rice_variety)))) then raise exception 'Packed products must use whole bag counts and the selected rice variety';end if;
 elsif exists(select 1 from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.input_kind<>'raw_material') then raise exception 'Milling inputs must be raw materials';end if;
 -- Stable lock order and the same center lock used by sales and stock transfers.
 for item in select distinct i.product_id,i.quality_id from public.manufacturing_order_inputs i where i.order_id=v_order.id order by i.product_id,i.quality_id loop
  perform pg_advisory_xact_lock(hashtextextended(v_order.organization_id::text||item.product_id::text||item.quality_id::text||v_order.location_id::text,51));
 end loop;
 v_origin:=case when v_order.process_type='packing' then 'packing_run' else 'manufacturing_order' end;
 for item in select i.* from public.manufacturing_order_inputs i where i.order_id=v_order.id order by i.created_at,i.id loop
  -- Allocations are already signed. Valuation must use the unchanged movement engine.
  select coalesce(sum(case when m.movement_type in ('purchase_in','transfer_in','adjustment_in') then m.quantity else -m.quantity end),0),
   coalesce(sum(case when m.movement_type in ('purchase_in','transfer_in','adjustment_in') then m.quantity*m.unit_cost else -m.quantity*m.unit_cost end),0)
   into v_available,v_value from public.stock_movements m where m.organization_id=v_order.organization_id and m.location_id=v_order.location_id and m.product_id=item.product_id and m.quality_id=item.quality_id;
  if v_available<item.quantity then raise exception 'Insufficient stock for production input';end if;
  if item.lot_id is not null then
   if not exists(select 1 from public.purchase_lots l where l.id=item.lot_id and l.organization_id=v_order.organization_id and l.product_id=item.product_id and l.quality_id=item.quality_id) then raise exception 'Invalid production lot';end if;
   select coalesce(sum(a.quantity),0) into v_lot_available from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id where m.organization_id=v_order.organization_id and m.location_id=v_order.location_id and m.product_id=item.product_id and m.quality_id=item.quality_id and a.lot_id=item.lot_id;
   if v_lot_available<item.quantity then raise exception 'Insufficient stock in selected lot';end if;
  end if;
  v_unit:=greatest(0,round(v_value/nullif(v_available,0),2));v_line_cost:=round(v_unit*item.quantity,2);v_material:=v_material+v_line_cost;
  insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
   values(v_order.organization_id,v_order.center_id,v_order.location_id,item.product_id,item.quality_id,'adjustment_out',item.quantity,v_unit,v_origin,v_order.id,auth.uid()) returning id into v_move;
  if item.lot_id is not null then
   delete from public.stock_lot_allocations where movement_id=v_move;
   insert into public.stock_lot_allocations(movement_id,lot_id,quantity,document_line_id) values(v_move,item.lot_id,-item.quantity,item.id);
  else update public.stock_lot_allocations set document_line_id=item.id where movement_id=v_move;end if;
  if item.sack_count>0 or (select tracks_sacks from public.products where id=item.product_id) then perform public.post_stock_sacks(v_order.organization_id,v_order.center_id,v_order.location_id,item.product_id,item.quality_id,-item.sack_count,v_origin,v_order.id,item.id);end if;
  update public.manufacturing_order_inputs set unit_cost=v_unit,line_cost=v_line_cost,stock_movement_id=v_move where id=item.id;
 end loop;
 select coalesce(sum(i.quantity),0) into v_input from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.input_kind in ('raw_material','bulk_rice');
 v_operation:=case when v_order.method='external' and v_order.process_type='milling' then round(v_input*v_order.external_mill_fee_per_kg,2)
  when v_order.operation_cost_basis='per_kg' then round(v_input*v_order.operation_cost_rate,2) when v_order.operation_cost_basis='per_hour' then round(v_order.operation_hours*v_order.operation_cost_rate,2) else v_order.operation_cost_rate end;
 v_total:=v_material+v_operation;
 select sum(case when v_order.process_type='packing' then x.quantity*x.package_size_kg else x.quantity end),sum(x.cost_share_percent),count(*) into v_weight,v_shares,v_count from public.manufacturing_order_outputs x where x.order_id=v_order.id;
 if v_weight<=0 or (v_shares>0 and abs(v_shares-100)>0.0001) then raise exception 'Output cost shares must total 100 percent or remain zero';end if;
 for produced in select x.* from public.manufacturing_order_outputs x where x.order_id=v_order.id order by x.created_at,x.id loop
  v_index:=v_index+1;
  v_line_cost:=case when v_index=v_count then v_total-v_allocated else least(v_total-v_allocated,round(v_total*(case when v_shares=0 then (case when v_order.process_type='packing' then produced.quantity*produced.package_size_kg else produced.quantity end)/v_weight else produced.cost_share_percent/100 end),2)) end;
  v_allocated:=v_allocated+v_line_cost;v_unit:=round(v_line_cost/produced.quantity,2);
  v_number:=(case when v_order.process_type='packing' then 'PKG-' else 'MFG-' end)||to_char(v_order.order_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_lot_number_seq')::text,8,'0');
  insert into public.purchase_lots(organization_id,product_id,quality_id,lot_number,created_by,source_type,source_order_id) values(v_order.organization_id,produced.product_id,produced.quality_id,v_number,auth.uid(),case when v_order.process_type='packing' then 'packing' else 'manufacturing' end,v_order.id) returning id into v_lot;
  insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
   values(v_order.organization_id,v_order.center_id,v_order.location_id,produced.product_id,produced.quality_id,'adjustment_in',produced.quantity,v_unit,v_origin,v_order.id,auth.uid()) returning id into v_move;
  update public.stock_lot_allocations set lot_id=v_lot,document_line_id=produced.id where movement_id=v_move;
  if produced.sack_count>0 or (select tracks_sacks from public.products where id=produced.product_id) then perform public.post_stock_sacks(v_order.organization_id,v_order.center_id,v_order.location_id,produced.product_id,produced.quality_id,produced.sack_count,v_origin,v_order.id,produced.id);end if;
  update public.manufacturing_order_outputs set stock_lot_id=v_lot,lot_number=v_number,unit_cost=v_unit,line_cost=v_line_cost,stock_movement_id=v_move where id=produced.id;
 end loop;
 update public.manufacturing_orders set status='completed',material_cost=v_material,operation_cost=v_operation,total_cost=v_total,completed_at=now(),completed_by=auth.uid() where id=v_order.id;
 return query select v_order.id,v_order.order_number,'completed'::text,v_total;
end $$;
commit;
