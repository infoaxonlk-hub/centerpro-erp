begin;
lock table public.stock_movements,public.stock_lot_allocations in share row exclusive mode;
-- Exact movement value is authoritative; six-place unit rates are display snapshots.
alter table public.stock_movements add column inventory_value numeric(24,6),add column cost_variance numeric(24,6) not null default 0;
alter table public.stock_movements add check(inventory_value>=0);
create index stock_movements_financial_scope on public.stock_movements(organization_id,center_id,created_at);
alter table public.stock_lot_allocations add column inventory_value numeric(24,6);
alter table public.sales_order_lines add column cogs_value numeric(24,6);
do $$ declare t text;begin
 foreach t in array array['stock_movements','sales_order_lines','bill_return_lines','stock_transfer_lines','stock_scrap_lines','stock_adjustments','manufacturing_order_inputs','manufacturing_order_outputs'] loop
  execute format('alter table public.%I alter column unit_cost type numeric(24,6)',t);
 end loop;
end $$;


update public.stock_lot_allocations a set inventory_value=round(a.quantity*m.unit_cost,6) from public.stock_movements m where m.id=a.movement_id;
-- Backfill before installing new guards, without changing historical economic values.
alter table public.stock_movements disable trigger lot_stock_dimension_lock;
update public.stock_movements set inventory_value=round(quantity*unit_cost,6);
alter table public.stock_movements enable trigger lot_stock_dimension_lock;
update public.sales_order_lines set cogs_value=round(quantity*unit_cost,6);
alter table public.stock_lot_allocations alter column inventory_value set not null;
alter table public.stock_lot_allocations add check((quantity>0 and inventory_value>=0) or (quantity<0 and inventory_value<=0));

alter table public.manufacturing_orders add column operation_expense_id uuid references public.expenses,
 add column external_expense_id uuid references public.expenses,
 add column valuation_method text;
alter table public.manufacturing_order_inputs alter column line_cost type numeric(24,6);
alter table public.manufacturing_order_outputs alter column line_cost type numeric(24,6);
alter table public.manufacturing_orders alter column material_cost type numeric(24,6),alter column operation_cost type numeric(24,6),alter column total_cost type numeric(24,6);
create table public.manufacturing_cost_entries(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 order_id uuid not null references public.manufacturing_orders,center_id uuid not null references public.centers,
 kind text not null check(kind in ('material','packaging','operation','external')),
 input_id uuid unique references public.manufacturing_order_inputs,
 expense_id uuid unique references public.expenses,
 stock_movement_id uuid unique references public.stock_movements,
 amount numeric(24,6) not null check(amount>=0),quantity numeric(24,6),rate numeric(24,6),
 source text not null check(source in ('stock_valuation','recorded_expense','configured_rate')),
 snapshot jsonb not null,created_at timestamptz not null default now()
);
create unique index manufacturing_conversion_once on public.manufacturing_cost_entries(order_id,kind) where input_id is null;
create index manufacturing_cost_order on public.manufacturing_cost_entries(order_id,created_at,id);
alter table public.manufacturing_cost_entries enable row level security;
revoke all on public.manufacturing_cost_entries from public,anon,authenticated;
grant select on public.manufacturing_cost_entries to authenticated;
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 definition:=replace(definition,'''manufacturing_order_outputs'') then return array[''manufacturing'']','''manufacturing_order_outputs'',''manufacturing_cost_entries'') then return array[''manufacturing'']');
 if position('manufacturing_cost_entries' in definition)=0 then raise exception 'Production cost module classification marker missing';end if;
 execute definition;
end $$;
create policy tenant_boundary on public.manufacturing_cost_entries as restrictive for all to authenticated
 using(organization_id=(public.current_profile()).organization_id) with check(organization_id=(public.current_profile()).organization_id);
create policy business_operation_boundary on public.manufacturing_cost_entries as restrictive for all to authenticated
 using(public.business_table_access('manufacturing_cost_entries',to_jsonb(manufacturing_cost_entries),false)) with check(public.business_table_access('manufacturing_cost_entries',to_jsonb(manufacturing_cost_entries),true));
create policy business_delete_boundary on public.manufacturing_cost_entries as restrictive for delete to authenticated using(public.business_table_access('manufacturing_cost_entries',to_jsonb(manufacturing_cost_entries),true));
create trigger tenant_write_guard before insert or update or delete on public.manufacturing_cost_entries for each row execute function public.enforce_tenant_write();
create trigger business_operation_guard before insert or update or delete on public.manufacturing_cost_entries for each row execute function public.enforce_business_operation();
create policy production_cost_read on public.manufacturing_cost_entries for select to authenticated using(
 organization_id=(public.current_profile()).organization_id and public.can_access_center(center_id)
 and public.business_table_access('manufacturing_orders',jsonb_build_object('organization_id',organization_id,'center_id',center_id),false)
 and (public.has_permission('manufacturing') or public.has_permission('stock')));
create function public.protect_production_cost_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
begin raise exception 'Completed production costing snapshots are immutable';end $$;
revoke all on function public.protect_production_cost_snapshot() from public,anon,authenticated;
create trigger production_cost_immutable before update or delete on public.manufacturing_cost_entries for each row execute function public.protect_production_cost_snapshot();
create function public.protect_completed_production() returns trigger language plpgsql security definer set search_path=public as $$
declare completed boolean;begin
 if tg_table_name='manufacturing_orders' then completed:=old.status='completed';
 else select status='completed' into completed from public.manufacturing_orders where id=old.order_id;end if;
 if completed then raise exception 'Completed production costing snapshots are immutable';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.protect_completed_production() from public,anon,authenticated;
create trigger completed_production_immutable before update or delete on public.manufacturing_orders for each row execute function public.protect_completed_production();
create trigger completed_production_immutable before update or delete on public.manufacturing_order_inputs for each row execute function public.protect_completed_production();
create trigger completed_production_immutable before update or delete on public.manufacturing_order_outputs for each row execute function public.protect_completed_production();
create function public.protect_absorbed_expense() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.manufacturing_cost_entries where expense_id=old.id) then
  if tg_op='DELETE' then raise exception 'Expense is capitalized into a completed production order';end if;
  if row(new.organization_id,new.center_id,new.expense_date,new.amount) is distinct from row(old.organization_id,old.center_id,old.expense_date,old.amount) then raise exception 'Capitalized expense amount and accounting dimensions are immutable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.protect_absorbed_expense() from public,anon,authenticated;
create trigger absorbed_expense_guard before update or delete on public.expenses for each row execute function public.protect_absorbed_expense();

create or replace function public.lock_lot_stock_dimension() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op<>'INSERT' then
  if tg_op='UPDATE' and pg_trigger_depth()>1 and old.inventory_value is null and new.inventory_value is not null
   and (to_jsonb(new)-'unit_cost'-'inventory_value'-'cost_variance')=(to_jsonb(old)-'unit_cost'-'inventory_value'-'cost_variance') then return new;end if;
  raise exception 'Posted stock movements are immutable';
 end if;
 new.inventory_value:=null;
 new.cost_variance:=0;
 perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||new.product_id::text||new.quality_id::text||new.location_id::text,51));
 return new;
end $$;

-- Value the actual physical allocation, AVCO within each lot and Legacy pool.
-- Reversals/transfers use the original allocation value, including rounding residue.
create function public.value_stock_lot_allocation() returns trigger language plpgsql security definer set search_path=public as $$
declare m public.stock_movements;src public.stock_lot_allocations;qty numeric;val numeric;used_qty numeric;used_value numeric;produced public.manufacturing_order_outputs;
begin
 select * into m from public.stock_movements where id=new.movement_id;
 if m.inventory_value is not null then raise exception 'Posted lot valuations are immutable';end if;
 if new.source_allocation_id is not null and new.quantity<0 and m.reference_type in ('purchase_return','purchase_cancellation') then
  -- Purchase credit uses the historical bill price; inventory leaves at its
  -- current carrying value. The finisher records the difference as variance.
  select coalesce(sum(a.quantity),0),coalesce(sum(a.inventory_value),0) into qty,val from public.stock_lot_allocations a join public.stock_movements s on s.id=a.movement_id
   where s.organization_id=m.organization_id and s.location_id=m.location_id and s.product_id=m.product_id and s.quality_id=m.quality_id and a.lot_id is not distinct from new.lot_id;
  if qty<abs(new.quantity) or val<0 then raise exception 'Insufficient valued lot stock';end if;
  val:=case when qty=abs(new.quantity) then val else round(val*abs(new.quantity)/qty,6) end;
 elsif new.source_allocation_id is not null then
  select * into src from public.stock_lot_allocations where id=new.source_allocation_id;
  select coalesce(sum(abs(a.quantity)),0),coalesce(sum(abs(a.inventory_value)),0) into used_qty,used_value from public.stock_lot_allocations a where a.source_allocation_id=src.id;
  if abs(new.quantity)>abs(src.quantity)-used_qty then raise exception 'Source valuation already reversed';end if;
  val:=case when abs(new.quantity)=abs(src.quantity)-used_qty then abs(src.inventory_value)-used_value else round(abs(src.inventory_value)*abs(new.quantity)/abs(src.quantity),6) end;
 elsif new.quantity>0 then
  if m.reference_type in ('manufacturing_order','packing_run') then
   select * into produced from public.manufacturing_order_outputs where id=nullif(current_setting('centerpro.production_output',true),'')::uuid and order_id=m.reference_id and product_id=m.product_id and quality_id=m.quality_id;
   if not found or produced.quantity<>new.quantity then raise exception 'Production output cost snapshot missing';end if;
   val:=produced.line_cost;
  else val:=round(new.quantity*m.unit_cost,6);end if;
 else
  select coalesce(sum(a.quantity),0),coalesce(sum(a.inventory_value),0) into qty,val
   from public.stock_lot_allocations a join public.stock_movements s on s.id=a.movement_id
   where s.organization_id=m.organization_id and s.location_id=m.location_id and s.product_id=m.product_id and s.quality_id=m.quality_id and a.lot_id is not distinct from new.lot_id;
  if qty<abs(new.quantity) or val<0 then raise exception 'Insufficient valued lot stock';end if;
  val:=case when qty=abs(new.quantity) then val else round(val*abs(new.quantity)/qty,6) end;
 end if;
 new.inventory_value:=case when new.quantity>0 then val else -val end;
 return new;
end $$;
revoke all on function public.value_stock_lot_allocation() from public,anon,authenticated;
create trigger value_stock_lot_allocation before insert on public.stock_lot_allocations for each row execute function public.value_stock_lot_allocation();

create function public.finish_stock_valuation() returns trigger language plpgsql security definer set search_path=public as $$
declare val numeric;line_id uuid;begin
 select abs(sum(inventory_value)) into val from public.stock_lot_allocations where movement_id=new.id;
 if val is null then raise exception 'Stock valuation allocation missing';end if;
 update public.stock_movements set inventory_value=val,unit_cost=round(val/new.quantity,6),cost_variance=case when new.reference_type in ('purchase_return','purchase_cancellation') then round(new.quantity*new.unit_cost,2)-val else 0 end where id=new.id;
 if new.reference_type='sales_order' then
  select document_line_id into line_id from public.stock_lot_allocations where movement_id=new.id limit 1;
  update public.sales_order_lines set unit_cost=round(val/new.quantity,6),cogs_value=val where id=line_id;
 elsif new.reference_type='stock_transfer' and new.movement_type='transfer_out' then
  update public.stock_transfer_lines set unit_cost=round(val/new.quantity,6),line_value=round(val,2) where transfer_id=new.reference_id and product_id=new.product_id and quality_id=new.quality_id;
 elsif new.reference_type='stock_scrap' then
  update public.stock_scrap_lines set unit_cost=round(val/new.quantity,6),line_value=round(val,2) where scrap_id=new.reference_id and product_id=new.product_id and quality_id=new.quality_id;
 end if;
 return new;
end $$;
revoke all on function public.finish_stock_valuation() from public,anon,authenticated;
create trigger zz_finish_stock_valuation after insert on public.stock_movements for each row execute function public.finish_stock_valuation();

-- Existing transfer/scrap headers used a pooled estimate before physical allocation.
-- Reconcile their totals inside the same transaction, before commit.
create function public.finish_inventory_document_value() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='stock_transfers' then
  update public.stock_transfers set total_value=(select round(coalesce(sum(inventory_value),0),2) from public.stock_movements where reference_type='stock_transfer' and reference_id=new.id and movement_type='transfer_out') where id=new.id;
 else
  update public.stock_scraps set total_value=(select round(coalesce(sum(inventory_value),0),2) from public.stock_movements where reference_type='stock_scrap' and reference_id=new.id) where id=new.id;
 end if;return null;
end $$;
revoke all on function public.finish_inventory_document_value() from public,anon,authenticated;
create constraint trigger reconcile_transfer_value after insert on public.stock_transfers deferrable initially deferred for each row execute function public.finish_inventory_document_value();
create constraint trigger reconcile_scrap_value after insert on public.stock_scraps deferrable initially deferred for each row execute function public.finish_inventory_document_value();

-- Production source identity is installed before allocation, never rewritten after posting.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.allocate_stock_lots()'::regprocedure);
 definition:=replace(definition,'incoming:=new.movement_type', $code$
 if new.reference_type in ('manufacturing_order','packing_run') then
  if new.movement_type='adjustment_in' then
   select x.id,x.stock_lot_id into document_line,original from public.manufacturing_order_outputs x where x.id=nullif(current_setting('centerpro.production_output',true),'')::uuid and x.order_id=new.reference_id;
   if document_line is null or original is null then raise exception 'Production output lot missing';end if;
   insert into public.stock_lot_allocations(movement_id,lot_id,quantity,document_line_id) values(new.id,original,new.quantity,document_line);return new;
  else
   select i.id,i.lot_id into document_line,original from public.manufacturing_order_inputs i where i.id=nullif(current_setting('centerpro.production_input',true),'')::uuid and i.order_id=new.reference_id;
   if document_line is null then raise exception 'Production input missing';end if;
   if original is not null then
    insert into public.stock_lot_allocations(movement_id,lot_id,quantity,document_line_id) values(new.id,original,-new.quantity,document_line);return new;
   end if;
  end if;
 end if;
 incoming:=new.movement_type
 $code$);
 if position('Production output lot missing' in definition)=0 then raise exception 'Allocation integration marker missing';end if;
 execute definition;
end $$;

create function public.post_production_conversion(p_order uuid,p_kind text,p_amount numeric,p_quantity numeric,p_rate numeric,p_expense uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare o public.manufacturing_orders;e public.expenses;amount numeric;begin
 select * into o from public.manufacturing_orders where id=p_order and status='draft' and organization_id=(public.current_profile()).organization_id;
 if not found or not public.can_access_center(o.center_id) then raise exception 'Draft production order access required';end if;
 if p_expense is not null then
  perform public.assert_business_operation('expenses');
  if not public.has_permission('cash') then raise exception 'Expense access required to capitalize a recorded expense';end if;
  select * into e from public.expenses where id=p_expense and organization_id=o.organization_id and center_id=o.center_id for update;
  if not found or e.expense_date>(now() at time zone 'Asia/Colombo')::date then raise exception 'Recorded expense must belong to this business/center and not be future dated';end if;
  if exists(select 1 from public.manufacturing_cost_entries where expense_id=e.id) then raise exception 'Expense has already been capitalized';end if;
  amount:=e.amount;
 else amount:=p_amount;end if;
 insert into public.manufacturing_cost_entries(organization_id,order_id,center_id,kind,expense_id,amount,quantity,rate,source,snapshot)
 values(o.organization_id,o.id,o.center_id,p_kind,p_expense,amount,p_quantity,p_rate,case when p_expense is null then 'configured_rate' else 'recorded_expense' end,
  case when p_expense is null then jsonb_build_object('basis',o.operation_cost_basis,'actual_quantity',p_quantity,'rate',p_rate,'treatment','Capitalized conversion accrual; no cash, payable or GL journal created')
   else jsonb_build_object('expense_id',e.id,'expense_date',e.expense_date,'amount',e.amount,'payee',e.payee,'reference',e.reference,'payment_status',e.payment_status,'treatment','Reclassify recorded expense into inventory; original settlement is unchanged') end);
 return amount;
end $$;
revoke all on function public.post_production_conversion(uuid,text,numeric,numeric,numeric,uuid) from public,anon,authenticated;

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
  select coalesce(sum(case when i.unit_of_measure='G' then i.quantity/1000 else i.quantity end),0) into v_input from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.input_kind='bulk_rice';
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
  v_unit:=greatest(0,round(v_value/nullif(v_available,0),2));v_line_cost:=round(v_unit*item.quantity,2);perform set_config('centerpro.production_input',item.id::text,true);
  insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
   values(v_order.organization_id,v_order.center_id,v_order.location_id,item.product_id,item.quality_id,'adjustment_out',item.quantity,v_unit,v_origin,v_order.id,auth.uid()) returning id into v_move;
  select inventory_value,unit_cost into v_line_cost,v_unit from public.stock_movements where id=v_move;
  v_material:=v_material+v_line_cost;
  insert into public.manufacturing_cost_entries(organization_id,order_id,center_id,kind,input_id,stock_movement_id,amount,quantity,rate,source,snapshot)
  values(v_order.organization_id,v_order.id,v_order.center_id,case when item.input_kind='packaging' then 'packaging' else 'material' end,item.id,v_move,v_line_cost,item.quantity,v_unit,'stock_valuation',jsonb_build_object('selected_lot_id',item.lot_id,'valuation','Oldest physical lots; weighted remaining value within each lot','allocations',(select jsonb_agg(jsonb_build_object('lot_id',a.lot_id,'quantity',a.quantity,'value',a.inventory_value)) from public.stock_lot_allocations a where a.movement_id=v_move)));
  if item.sack_count>0 or (select tracks_sacks from public.products where id=item.product_id) then perform public.post_stock_sacks(v_order.organization_id,v_order.center_id,v_order.location_id,item.product_id,item.quality_id,-item.sack_count,v_origin,v_order.id,item.id);end if;
  update public.manufacturing_order_inputs set unit_cost=v_unit,line_cost=v_line_cost,stock_movement_id=v_move where id=item.id;
 end loop;
 if (v_order.operation_cost_basis='per_kg' or (v_order.method='external' and v_order.process_type='milling')) and exists(select 1 from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.input_kind in ('raw_material','bulk_rice') and i.unit_of_measure not in ('KG','G')) then raise exception 'Per-kg production costing requires KG/G inputs; use hourly or batch labor for count-based materials';end if;
 select coalesce(sum(case when i.unit_of_measure='G' then i.quantity/1000 else i.quantity end),0) into v_input from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.input_kind in ('raw_material','bulk_rice');
 v_operation:=public.post_production_conversion(v_order.id,'operation',
  case when v_order.operation_cost_basis='per_kg' then round(v_input*v_order.operation_cost_rate,6) when v_order.operation_cost_basis='per_hour' then round(v_order.operation_hours*v_order.operation_cost_rate,6) else v_order.operation_cost_rate end,
  case when v_order.operation_cost_basis='per_hour' then v_order.operation_hours when v_order.operation_cost_basis='per_batch' then 1 else v_input end,v_order.operation_cost_rate,v_order.operation_expense_id);
 if v_order.method='external' and v_order.process_type='milling' then
  v_operation:=v_operation+public.post_production_conversion(v_order.id,'external',round(v_input*v_order.external_mill_fee_per_kg,6),v_input,v_order.external_mill_fee_per_kg,v_order.external_expense_id);
 elsif v_order.external_expense_id is not null then raise exception 'External expense requires external milling';end if;
 v_total:=v_material+v_operation;
 select sum(case when v_order.process_type='packing' then x.quantity*x.package_size_kg when x.unit_of_measure='G' then x.quantity/1000 else x.quantity end),sum(x.cost_share_percent),count(*) into v_weight,v_shares,v_count from public.manufacturing_order_outputs x where x.order_id=v_order.id;
 if v_shares=0 and v_order.process_type='milling' and exists(select 1 from public.manufacturing_order_outputs x where x.order_id=v_order.id and x.unit_of_measure in ('KG','G')) and exists(select 1 from public.manufacturing_order_outputs x where x.order_id=v_order.id and x.unit_of_measure not in ('KG','G')) then raise exception 'Mixed weight/count output units require explicit cost shares';end if;
 if v_weight<=0 or (v_shares>0 and abs(v_shares-100)>0.0001) then raise exception 'Output cost shares must total 100 percent or remain zero';end if;
 for produced in select x.* from public.manufacturing_order_outputs x where x.order_id=v_order.id order by case when v_shares>0 and x.cost_share_percent=0 then 0 else 1 end,x.created_at,x.id loop
  v_index:=v_index+1;
  v_line_cost:=case when v_index=v_count then v_total-v_allocated else least(v_total-v_allocated,round(v_total*(case when v_shares=0 then (case when v_order.process_type='packing' then produced.quantity*produced.package_size_kg when produced.unit_of_measure='G' then produced.quantity/1000 else produced.quantity end)/v_weight else produced.cost_share_percent/100 end),6)) end;
  v_allocated:=v_allocated+v_line_cost;v_unit:=round(v_line_cost/produced.quantity,6);
  v_number:=(case when v_order.process_type='packing' then 'PKG-' else 'MFG-' end)||to_char(v_order.order_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_lot_number_seq')::text,8,'0');
  insert into public.purchase_lots(organization_id,product_id,quality_id,lot_number,created_by,source_type,source_order_id) values(v_order.organization_id,produced.product_id,produced.quality_id,v_number,auth.uid(),case when v_order.process_type='packing' then 'packing' else 'manufacturing' end,v_order.id) returning id into v_lot;
  update public.manufacturing_order_outputs set stock_lot_id=v_lot,lot_number=v_number,unit_cost=v_unit,line_cost=v_line_cost where id=produced.id;
  perform set_config('centerpro.production_output',produced.id::text,true);
  insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
   values(v_order.organization_id,v_order.center_id,v_order.location_id,produced.product_id,produced.quality_id,'adjustment_in',produced.quantity,v_unit,v_origin,v_order.id,auth.uid()) returning id into v_move;

  if produced.sack_count>0 or (select tracks_sacks from public.products where id=produced.product_id) then perform public.post_stock_sacks(v_order.organization_id,v_order.center_id,v_order.location_id,produced.product_id,produced.quality_id,produced.sack_count,v_origin,v_order.id,produced.id);end if;
  update public.manufacturing_order_outputs set stock_lot_id=v_lot,lot_number=v_number,unit_cost=v_unit,line_cost=v_line_cost,stock_movement_id=v_move where id=produced.id;
 end loop;
 update public.manufacturing_orders set status='completed',valuation_method='Physical oldest-lot allocation / AVCO within lot; exact six-decimal movement value',material_cost=v_material,operation_cost=v_operation,total_cost=v_total,completed_at=now(),completed_by=auth.uid() where id=v_order.id;
 return query select v_order.id,v_order.order_number,'completed'::text,v_total;
end $$;

-- Preserve old product/default price semantics. All valuation reads now use exact
-- movement values rather than re-multiplying rounded unit rates.
do $$ declare f record;definition text;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosrc like '%stock_movements%' loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'m.quantity*m.unit_cost','m.inventory_value');
  definition:=replace(definition,'s.quantity*s.unit_cost','s.inventory_value');
  definition:=replace(definition,'round(v_value/nullif(v_available,0),2)','round(v_value/nullif(v_available,0),6)');
  definition:=replace(definition,'round(v_stock_value/nullif(v_available,0),2)','round(v_stock_value/nullif(v_available,0),6)');
  definition:=replace(definition,'round(stock_value/available,2)','round(stock_value/available,6)');
  definition:=replace(definition,'round(stock_value/nullif(available,0),2)','round(stock_value/nullif(available,0),6)');
  definition:=replace(definition,'v_total_value:=v_total_value+round(v_quantity*v_unit_cost,2);','select round(coalesce(sum(m.inventory_value),0),2) into v_total_value from public.stock_movements m where m.reference_type=''stock_transfer'' and m.reference_id=v_transfer and m.movement_type=''transfer_out'';');
  definition:=replace(definition,'sum_value:=sum_value+round(qty*cost,2);','select round(coalesce(sum(m.inventory_value),0),2) into sum_value from public.stock_movements m where m.reference_type=''stock_scrap'' and m.reference_id=scrap_id;');
  definition:=regexp_replace(definition,'(?<![a-zA-Z_.])quantity\s*\*\s*unit_cost','inventory_value','g');
  if definition<>pg_get_functiondef(f.oid) then execute definition;end if;
 end loop;
 definition:=pg_get_functiondef('public.save_manufacturing_order(uuid,jsonb)'::regprocedure);
 definition:=replace(definition,' return query select result_id,n;', $code$
 if nullif(p_data->>'operation_expense_id','') is not null or nullif(p_data->>'external_expense_id','') is not null then
  perform public.assert_business_operation('expenses');if not public.has_permission('cash') then raise exception 'Expense access required';end if;
 end if;
 if nullif(p_data->>'operation_expense_id','') is not null and p_data->>'operation_expense_id'=p_data->>'external_expense_id' then raise exception 'The same expense cannot fund labor and external service twice';end if;
 if exists(select 1 from unnest(array[nullif(p_data->>'operation_expense_id','')::uuid,nullif(p_data->>'external_expense_id','')::uuid]) e(id) where e.id is not null and not exists(select 1 from public.expenses x where x.id=e.id and x.organization_id=org and x.center_id=center)) then raise exception 'Invalid production expense source';end if;
 update public.manufacturing_orders set operation_expense_id=nullif(p_data->>'operation_expense_id','')::uuid,external_expense_id=nullif(p_data->>'external_expense_id','')::uuid where id=result_id;
 return query select result_id,n;
 $code$);
 if position('Invalid production expense source' in definition)=0 then raise exception 'Production draft integration marker missing';end if;
 execute definition;
end $$;

create function public.stock_lot_valuations()
returns table(center_id uuid,location_id uuid,product_id uuid,quality_id uuid,lot_id uuid,available_quantity numeric,inventory_value numeric,unit_cost numeric,lot_number text,received_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 -- Reuse existing inventory/manufacturing tenant, center and licence gates.
 perform public.stock_lot_balances();
 return query select m.center_id,m.location_id,m.product_id,m.quality_id,a.lot_id,sum(a.quantity),sum(a.inventory_value),sum(a.inventory_value)/nullif(sum(a.quantity),0),
  coalesce((select l.lot_number from public.purchase_lots l where l.id=a.lot_id),'Unassigned / Legacy'),
  case when a.lot_id is null then '-infinity'::timestamptz else least((select min(r.received_at) from public.purchase_lot_receipts r where r.lot_id=a.lot_id),(select l.created_at from public.purchase_lots l where l.id=a.lot_id)) end
 from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id
 where m.organization_id=(public.current_profile()).organization_id and public.can_access_center(m.center_id)
 group by m.center_id,m.location_id,m.product_id,m.quality_id,a.lot_id having sum(a.quantity)<>0;
end $$;
revoke all on function public.stock_lot_valuations() from public,anon;
grant execute on function public.stock_lot_valuations() to authenticated;

-- Exact stock value and sales COGS subledger: no full chart of accounts exists.
create function public.profit_loss_report(p_from date,p_to date,p_center uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare org uuid;revenue numeric;cost numeric;expense numeric;capitalized numeric;stock_value numeric;scrap numeric;variance numeric;
begin
 perform public.assert_business_operation('payment_reports');perform public.assert_business_operation('sales');perform public.assert_business_operation('inventory');perform public.assert_business_operation('expenses');
 if not public.has_permission('payment_reports') then raise exception 'Financial report access required';end if;
 org:=(public.current_profile()).organization_id;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Valid report date range required';end if;
 if p_center is not null and not exists(select 1 from public.centers where id=p_center and organization_id=org and public.can_access_center(id)) then raise exception 'Center access denied';end if;
 select coalesce(sum(x.amount),0) into revenue from (
  select (select coalesce(sum(l.line_total),0) from public.sales_order_lines l where l.sales_order_id=o.id) amount,o.center_id,(o.confirmed_at at time zone 'Asia/Colombo')::date d from public.sales_orders o where o.organization_id=org
  union all select -r.total_amount,r.center_id,(r.reviewed_at at time zone 'Asia/Colombo')::date from public.bill_returns r where r.organization_id=org and r.bill_type='sale' and r.status='approved'
  union all select -((select coalesce(sum(l.line_total),0) from public.sales_order_lines l where l.sales_order_id=o.id)-(select coalesce(sum(t.total_amount),0) from public.bill_returns t where t.bill_id=o.id and t.bill_type='sale' and t.status='approved' and t.reviewed_at<=r.reviewed_at)),o.center_id,(r.reviewed_at at time zone 'Asia/Colombo')::date from public.bill_cancel_requests r join public.sales_orders o on o.id=r.bill_id where o.organization_id=org and r.bill_type='sale' and r.status='approved'
 ) x where public.can_access_center(x.center_id) and (p_center is null or x.center_id=p_center) and x.d between p_from and p_to;
 select coalesce(sum(case when reference_type='sales_order' then inventory_value else -inventory_value end),0) into cost from public.stock_movements
 where organization_id=org and public.can_access_center(center_id) and (p_center is null or center_id=p_center) and reference_type in ('sales_order','sales_return','sale_cancellation') and (created_at at time zone 'Asia/Colombo')::date between p_from and p_to;
 select coalesce(sum(amount),0) into expense from public.expenses where organization_id=org and public.can_access_center(center_id) and (p_center is null or center_id=p_center) and expense_date between p_from and p_to;
 select coalesce(sum(e.amount),0) into capitalized from public.manufacturing_cost_entries e join public.manufacturing_orders o on o.id=e.order_id where e.organization_id=org and e.expense_id is not null and public.can_access_center(e.center_id) and (p_center is null or e.center_id=p_center) and o.status='completed' and (o.completed_at at time zone 'Asia/Colombo')::date between p_from and p_to;
 select coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then inventory_value else -inventory_value end),0) into stock_value from public.stock_movements where organization_id=org and public.can_access_center(center_id) and (p_center is null or center_id=p_center) and (created_at at time zone 'Asia/Colombo')::date<=p_to;
 select coalesce(sum(inventory_value),0) into scrap from public.stock_movements where organization_id=org and public.can_access_center(center_id) and (p_center is null or center_id=p_center) and reference_type='stock_scrap' and (created_at at time zone 'Asia/Colombo')::date between p_from and p_to;
 select coalesce(sum(cost_variance),0) into variance from public.stock_movements where organization_id=org and public.can_access_center(center_id) and (p_center is null or center_id=p_center) and (created_at at time zone 'Asia/Colombo')::date between p_from and p_to;
 return jsonb_build_object('revenue',revenue,'cogs',cost,'grossProfit',revenue-cost,'recordedExpenses',expense,'capitalizedExpenses',capitalized,'operatingExpenses',expense-capitalized,'scrapLoss',scrap,'purchaseCostVariance',variance,'netProfit',revenue-cost-expense+capitalized-scrap+variance,'closingInventory',stock_value,'boundary','Management P&L / valuation subledger; not a statutory general ledger');
end $$;
revoke all on function public.profit_loss_report(date,date,uuid) from public,anon;
grant execute on function public.profit_loss_report(date,date,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
