begin;

-- Manufacturing is licensed per business and depends on Inventory.
insert into public.business_module_catalog(key,name,parent_key,mandatory)
values('manufacturing','Manufacturing','inventory',false)
on conflict(key) do update set name=excluded.name,parent_key=excluded.parent_key;

do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.business_module_user_allowed(text)'::regprocedure);
 definition:=replace(definition,
   'when ''audit'' then ''audit''=any(p.permissions)',
   'when ''audit'' then ''audit''=any(p.permissions)'||chr(10)||' when ''manufacturing'' then ''manufacturing''=any(p.permissions)');
 definition:=replace(definition,
   'when ''manufacturing'' then ''manufacturing''=any(p.permissions)',
   'when ''manufacturing'' then ''manufacturing''=any(p.permissions) or ''stock''=any(p.permissions)');
 if position('when ''manufacturing'' then' in definition)=0 then raise exception 'Manufacturing permission mapping marker missing'; end if;
 execute definition;

 definition:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 definition:=replace(definition,
   'when p_table in (''stock_movements'',''stock_lot_allocations'') then return array[''inventory''];',
   'when p_table in (''manufacturing_recipes'',''manufacturing_orders'',''manufacturing_order_inputs'',''manufacturing_order_outputs'') then return array[''manufacturing''];'||chr(10)||' when p_table=''stock_movements'' then return case when p_row->>''reference_type'' in (''manufacturing_order'',''packing_run'') then array[''manufacturing''] else array[''inventory''] end;'||chr(10)||' when p_table=''stock_lot_allocations'' then return case when exists(select 1 from public.stock_movements m where m.id=(p_row->>''movement_id'')::uuid and m.reference_type in (''manufacturing_order'',''packing_run'')) then array[''manufacturing''] else array[''inventory''] end;');
 definition:=replace(definition,
   'when p_table in (''purchase_order_lines'',''offline_purchase_requests'',''purchase_lots'',''purchase_lot_receipts'') then return array[''purchases''];',
   'when p_table in (''purchase_order_lines'',''offline_purchase_requests'',''purchase_lot_receipts'') then return array[''purchases''];'||chr(10)||' when p_table=''purchase_lots'' then return case when coalesce(p_row->>''source_type'',''purchase'') in (''manufacturing'',''packing'') then array[''manufacturing''] else array[''purchases'',''manufacturing''] end;');
 definition:=replace(definition,
   'when p_table in (''products'',''product_qualities'',''product_categories'') then return case when p_write then array[''masters''] else array[''masters'',''sales'',''purchases'',''inventory'',''stock_adjustments''] end;',
   'when p_table in (''products'',''product_qualities'',''product_categories'') then return case when p_write then array[''masters''] else array[''masters'',''sales'',''purchases'',''inventory'',''stock_adjustments'',''manufacturing''] end;');
 definition:=replace(definition,
   'when p_table=''suppliers'' then return array[''purchases'',''masters'',''supplier_payables''];',
   'when p_table=''suppliers'' then return case when p_write then array[''purchases'',''masters'',''supplier_payables''] else array[''purchases'',''masters'',''supplier_payables'',''manufacturing''] end;');
 if position('manufacturing_order_inputs' in definition)=0 or position('stock_lot_allocations' in definition)=0 or position('source_type' in definition)=0 then raise exception 'Manufacturing table access mapping marker missing'; end if;
 execute definition;
end $$;

-- Manufacturing can read the lot balance RPC without requiring a separate stock grant.
create or replace function public.stock_lot_balances()
returns table(center_id uuid,location_id uuid,product_id uuid,quality_id uuid,lot_id uuid,lot_number text,available_quantity numeric)
language plpgsql stable security definer set search_path=public as $$
begin
 if public.has_permission('manufacturing') then perform public.assert_business_operation('manufacturing');
 else perform public.assert_business_operation('inventory'); end if;
 if not public.has_permission('stock') and not public.has_permission('manufacturing') then raise exception 'Stock access required'; end if;
 return query select m.center_id,m.location_id,m.product_id,m.quality_id,a.lot_id,coalesce(l.lot_number,'Unassigned / Legacy'),sum(a.quantity)
 from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id left join public.purchase_lots l on l.id=a.lot_id
 where m.organization_id=(public.current_profile()).organization_id and public.can_access_center(m.center_id)
 group by m.center_id,m.location_id,m.product_id,m.quality_id,a.lot_id,l.lot_number having sum(a.quantity)<>0
 order by m.product_id,m.quality_id,m.center_id,m.location_id,l.lot_number nulls first;
end $$;

create sequence public.manufacturing_order_number_seq;
create sequence public.manufacturing_recipe_number_seq;

create table public.manufacturing_recipes(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 recipe_code text not null,
 name text not null check(length(trim(name)) between 2 and 120),
 process_type text not null check(process_type in ('milling','packing')),
 rice_variety text not null default '' check(length(rice_variety)<=80),
 operation_name text not null default 'Production operation' check(length(operation_name)<=120),
 operation_cost_basis text not null default 'per_kg' check(operation_cost_basis in ('per_kg','per_hour','per_batch')),
 operation_cost_rate numeric(18,2) not null default 0 check(operation_cost_rate>=0),
 external_mill_fee_per_kg numeric(18,2) not null default 0 check(external_mill_fee_per_kg>=0),
 is_active boolean not null default true,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,recipe_code),
 unique(organization_id,name,process_type,rice_variety)
);

create table public.manufacturing_orders(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 order_number text not null,
 center_id uuid not null references public.centers(id),
 location_id uuid not null references public.locations(id),
 process_type text not null check(process_type in ('milling','packing')),
 method text not null check(method in ('own','external')),
 status text not null default 'draft' check(status in ('draft','completed','cancelled')),
 rice_variety text not null default '' check(length(rice_variety)<=80),
 recipe_id uuid references public.manufacturing_recipes(id),
 supplier_id uuid references public.suppliers(id),
 order_date date not null default (now() at time zone 'Asia/Colombo')::date,
 operation_cost_basis text not null default 'per_kg' check(operation_cost_basis in ('per_kg','per_hour','per_batch')),
 operation_cost_rate numeric(18,2) not null default 0 check(operation_cost_rate>=0),
 operation_hours numeric(12,3) not null default 0 check(operation_hours>=0),
 external_mill_fee_per_kg numeric(18,2) not null default 0 check(external_mill_fee_per_kg>=0),
 material_cost numeric(18,2) not null default 0 check(material_cost>=0),
 operation_cost numeric(18,2) not null default 0 check(operation_cost>=0),
 total_cost numeric(18,2) not null default 0 check(total_cost>=0),
 notes text not null default '' check(length(notes)<=1000),
 created_by uuid not null references public.profiles(id),
 completed_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(organization_id,order_number)
);
create index manufacturing_orders_business_date on public.manufacturing_orders(organization_id,order_date desc,created_at desc);
create index manufacturing_orders_center on public.manufacturing_orders(center_id,location_id,created_at desc);

create table public.manufacturing_order_inputs(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 order_id uuid not null references public.manufacturing_orders(id) on delete cascade,
 input_kind text not null check(input_kind in ('raw_material','bulk_rice','packaging')),
 product_id uuid not null references public.products(id),
 quality_id uuid not null references public.product_qualities(id),
 lot_id uuid references public.purchase_lots(id),
 lot_number text not null default '',
 quantity numeric(18,3) not null check(quantity>0),
 unit_of_measure text not null,
 unit_cost numeric(18,2) not null default 0 check(unit_cost>=0),
 line_cost numeric(18,2) not null default 0 check(line_cost>=0),
 stock_movement_id uuid references public.stock_movements(id),
 created_at timestamptz not null default now()
);
create index manufacturing_inputs_order on public.manufacturing_order_inputs(order_id,created_at,id);

create table public.manufacturing_order_outputs(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 order_id uuid not null references public.manufacturing_orders(id) on delete cascade,
 output_kind text not null check(output_kind in ('main','byproduct','packed')),
 product_id uuid not null references public.products(id),
 quality_id uuid not null references public.product_qualities(id),
 quantity numeric(18,3) not null check(quantity>0),
 unit_of_measure text not null,
 package_size_kg numeric(10,3),
 packaging_product_id uuid references public.products(id),
 packaging_quality_id uuid references public.product_qualities(id),
 cost_share_percent numeric(7,4) not null default 0 check(cost_share_percent between 0 and 100),
 stock_lot_id uuid references public.purchase_lots(id),
 lot_number text not null default '',
 unit_cost numeric(18,2) not null default 0 check(unit_cost>=0),
 line_cost numeric(18,2) not null default 0 check(line_cost>=0),
 stock_movement_id uuid references public.stock_movements(id),
 created_at timestamptz not null default now(),
 check((output_kind='packed' and package_size_kg is not null and package_size_kg>0 and packaging_product_id is not null and packaging_quality_id is not null)
    or (output_kind<>'packed' and package_size_kg is null))
);
create index manufacturing_outputs_order on public.manufacturing_order_outputs(order_id,created_at,id);

-- Use the existing lot registry for all physical stock batches. Purchase receipts
-- remain separately recorded in purchase_lot_receipts.
alter table public.purchase_lots
 add column source_type text not null default 'purchase' check(source_type in ('purchase','manufacturing','packing')),
 add column source_order_id uuid references public.manufacturing_orders(id);
create index purchase_lots_source on public.purchase_lots(source_type,source_order_id);
drop policy if exists purchase_lots_read on public.purchase_lots;
create policy purchase_lots_read on public.purchase_lots for select to authenticated
 using(public.has_permission('purchases') or public.has_permission('manufacturing') or public.has_permission('stock'));

alter table public.manufacturing_recipes enable row level security;
alter table public.manufacturing_orders enable row level security;
alter table public.manufacturing_order_inputs enable row level security;
alter table public.manufacturing_order_outputs enable row level security;
revoke all on public.manufacturing_recipes,public.manufacturing_orders,public.manufacturing_order_inputs,public.manufacturing_order_outputs from public,anon,authenticated;
grant select on public.manufacturing_recipes,public.manufacturing_orders,public.manufacturing_order_inputs,public.manufacturing_order_outputs to authenticated;
create policy manufacturing_recipes_read on public.manufacturing_recipes for select to authenticated using(public.has_permission('manufacturing') or public.has_permission('stock'));
create policy manufacturing_orders_read on public.manufacturing_orders for select to authenticated using((public.has_permission('manufacturing') or public.has_permission('stock')) and public.can_access_center(center_id));
create policy manufacturing_inputs_read on public.manufacturing_order_inputs for select to authenticated using((public.has_permission('manufacturing') or public.has_permission('stock')) and exists(select 1 from public.manufacturing_orders o where o.id=order_id and public.can_access_center(o.center_id)));
create policy manufacturing_outputs_read on public.manufacturing_order_outputs for select to authenticated using((public.has_permission('manufacturing') or public.has_permission('stock')) and exists(select 1 from public.manufacturing_orders o where o.id=order_id and public.can_access_center(o.center_id)));

do $$ declare t text; begin
 foreach t in array array['manufacturing_recipes','manufacturing_orders','manufacturing_order_inputs','manufacturing_order_outputs'] loop
  execute format('create policy tenant_boundary on public.%I as restrictive for all to authenticated using(public.tenant_row_organization(%L::regclass,to_jsonb(%I))=(public.current_profile()).organization_id) with check(public.tenant_row_organization(%L::regclass,to_jsonb(%I))=(public.current_profile()).organization_id)',t,'public.'||t,t,'public.'||t,t);
  execute format('create policy business_operation_boundary on public.%I as restrictive for all to authenticated using(public.business_table_access(%L,to_jsonb(%I),false)) with check(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t,t,t);
  execute format('create policy business_delete_boundary on public.%I as restrictive for delete to authenticated using(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t);
  execute format('create trigger tenant_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write()',t);
  execute format('create trigger business_operation_guard before insert or update or delete on public.%I for each row execute function public.enforce_business_operation()',t);
 end loop;
end $$;

create function public.save_manufacturing_recipe(p_recipe_id uuid,p_data jsonb)
returns table(recipe_id uuid,recipe_code text)
language plpgsql security definer set search_path=public as $$
declare org uuid; actor uuid; code text; result_id uuid; n text; process text;
begin
 perform public.assert_business_operation('manufacturing');
 if not public.has_permission('manufacturing') and not public.has_permission('stock') then raise exception 'Manufacturing access required'; end if;
 org:=(public.current_profile()).organization_id; actor:=auth.uid();
 n:=trim(coalesce(p_data->>'name','')); process:=coalesce(p_data->>'process_type','');
 if length(n) not between 2 and 120 or process not in ('milling','packing') then raise exception 'Enter a recipe name and valid process'; end if;
 if coalesce(p_data->>'operation_cost_basis','per_kg') not in ('per_kg','per_hour','per_batch') then raise exception 'Invalid operation cost basis'; end if;
 if coalesce(p_data->>'operation_cost_rate','0')::numeric<0 or coalesce(p_data->>'external_mill_fee_per_kg','0')::numeric<0 then raise exception 'Cost rates cannot be negative'; end if;
 if p_recipe_id is null then
  code:='BOM-'||lpad(nextval('public.manufacturing_recipe_number_seq')::text,6,'0');
  insert into public.manufacturing_recipes(organization_id,recipe_code,name,process_type,rice_variety,operation_name,operation_cost_basis,operation_cost_rate,external_mill_fee_per_kg,created_by)
  values(org,code,n,process,trim(coalesce(p_data->>'rice_variety','')),trim(coalesce(p_data->>'operation_name','Production operation')),coalesce(p_data->>'operation_cost_basis','per_kg'),coalesce((p_data->>'operation_cost_rate')::numeric,0),coalesce((p_data->>'external_mill_fee_per_kg')::numeric,0),actor)
  returning id into result_id;
 else
  update public.manufacturing_recipes set name=n,process_type=process,rice_variety=trim(coalesce(p_data->>'rice_variety','')),operation_name=trim(coalesce(p_data->>'operation_name','Production operation')),
   operation_cost_basis=coalesce(p_data->>'operation_cost_basis','per_kg'),operation_cost_rate=coalesce((p_data->>'operation_cost_rate')::numeric,0),external_mill_fee_per_kg=coalesce((p_data->>'external_mill_fee_per_kg')::numeric,0),updated_at=now()
  where id=p_recipe_id and organization_id=org and is_active returning id,manufacturing_recipes.recipe_code into result_id,code;
  if result_id is null then raise exception 'Recipe not found or inactive'; end if;
 end if;
 if code is null then select r.recipe_code into code from public.manufacturing_recipes r where r.id=result_id; end if;
 return query select result_id,code;
end $$;

create function public.save_manufacturing_order(p_order_id uuid,p_data jsonb)
returns table(order_id uuid,order_number text)
language plpgsql security definer set search_path=public as $$
declare org uuid; actor uuid; result_id uuid; n text; center uuid; loc uuid; process text; v_method text; supplier uuid; rec uuid; recipe public.manufacturing_recipes; input jsonb; output jsonb; var text; code text;
begin
 perform public.assert_business_operation('manufacturing');
 if not public.has_permission('manufacturing') and not public.has_permission('stock') then raise exception 'Manufacturing access required'; end if;
 org:=(public.current_profile()).organization_id; actor:=auth.uid();
 center:=nullif(p_data->>'center_id','')::uuid;loc:=nullif(p_data->>'location_id','')::uuid;
 process:=coalesce(p_data->>'process_type','');v_method:=coalesce(p_data->>'method','own');supplier:=nullif(p_data->>'supplier_id','')::uuid;rec:=nullif(p_data->>'recipe_id','')::uuid;
 var:=trim(coalesce(p_data->>'rice_variety',''));
 if process not in ('milling','packing') or v_method not in ('own','external') then raise exception 'Select a valid production process and method'; end if;
 if center is null or loc is null or not public.can_access_center(center) or not exists(select 1 from public.locations l where l.id=loc and l.center_id=center and l.is_active) then raise exception 'Select an active stock location you can access'; end if;
 if v_method='external' and (supplier is null or not exists(select 1 from public.suppliers s where s.id=supplier and s.organization_id=org and s.is_active)) then raise exception 'Select an active external mill supplier'; end if;
 if v_method='own' then supplier:=null; end if;
 if coalesce(p_data->>'operation_cost_basis','per_kg') not in ('per_kg','per_hour','per_batch') then raise exception 'Invalid operation cost basis'; end if;
 if coalesce((p_data->>'operation_cost_rate')::numeric,0)<0 or coalesce((p_data->>'operation_hours')::numeric,0)<0 or coalesce((p_data->>'external_mill_fee_per_kg')::numeric,0)<0 then raise exception 'Production costs cannot be negative'; end if;
 if p_data->>'inputs' is null or jsonb_typeof(p_data->'inputs')<>'array' or jsonb_array_length(p_data->'inputs')=0 then raise exception 'Add at least one input line'; end if;
 if p_data->>'outputs' is null or jsonb_typeof(p_data->'outputs')<>'array' or jsonb_array_length(p_data->'outputs')=0 then raise exception 'Add at least one output line'; end if;
 if rec is not null then
  select * into recipe from public.manufacturing_recipes r where r.id=rec and r.organization_id=org and r.is_active and r.process_type=process;
  if not found then raise exception 'Selected recipe does not match this process'; end if;
 end if;
 if p_order_id is null then
  n:='MO-'||lpad(nextval('public.manufacturing_order_number_seq')::text,7,'0');
  insert into public.manufacturing_orders(organization_id,order_number,center_id,location_id,process_type,method,rice_variety,recipe_id,supplier_id,order_date,operation_cost_basis,operation_cost_rate,operation_hours,external_mill_fee_per_kg,notes,created_by)
  values(org,n,center,loc,process,v_method,var,rec,supplier,coalesce(nullif(p_data->>'order_date','')::date,(now() at time zone 'Asia/Colombo')::date),coalesce(p_data->>'operation_cost_basis','per_kg'),coalesce((p_data->>'operation_cost_rate')::numeric,0),coalesce((p_data->>'operation_hours')::numeric,0),coalesce((p_data->>'external_mill_fee_per_kg')::numeric,0),left(coalesce(p_data->>'notes',''),1000),actor) returning id into result_id;
 else
  select o.order_number into n from public.manufacturing_orders o where o.id=p_order_id and o.organization_id=org and o.status='draft' for update;
  if n is null then raise exception 'Draft order not found or already posted'; end if;
  result_id:=p_order_id;
  update public.manufacturing_orders set center_id=center,location_id=loc,process_type=process,method=v_method,rice_variety=var,recipe_id=rec,supplier_id=supplier,
   order_date=coalesce(nullif(p_data->>'order_date','')::date,(now() at time zone 'Asia/Colombo')::date),operation_cost_basis=coalesce(p_data->>'operation_cost_basis','per_kg'),
   operation_cost_rate=coalesce((p_data->>'operation_cost_rate')::numeric,0),operation_hours=coalesce((p_data->>'operation_hours')::numeric,0),external_mill_fee_per_kg=coalesce((p_data->>'external_mill_fee_per_kg')::numeric,0),notes=left(coalesce(p_data->>'notes',''),1000)
  where id=result_id;
  delete from public.manufacturing_order_inputs where manufacturing_order_inputs.order_id=result_id;
  delete from public.manufacturing_order_outputs where manufacturing_order_outputs.order_id=result_id;
 end if;
 for input in select value from jsonb_array_elements(p_data->'inputs') loop
  if coalesce(input->>'input_kind','') not in ('raw_material','bulk_rice','packaging') or coalesce((input->>'quantity')::numeric,0)<=0 then raise exception 'Each input needs a valid type and positive quantity'; end if;
  if not exists(select 1 from public.products p join public.product_qualities q on q.product_id=p.id where p.id=(input->>'product_id')::uuid and p.organization_id=org and p.is_active and q.id=(input->>'quality_id')::uuid and q.is_active) then raise exception 'An input product or quality is invalid'; end if;
  if nullif(input->>'lot_id','') is not null and not exists(select 1 from public.purchase_lots l where l.id=(input->>'lot_id')::uuid and l.organization_id=org and l.product_id=(input->>'product_id')::uuid and l.quality_id=(input->>'quality_id')::uuid) then raise exception 'An input lot does not match its product and quality'; end if;
  insert into public.manufacturing_order_inputs(organization_id,order_id,input_kind,product_id,quality_id,lot_id,lot_number,quantity,unit_of_measure)
  select org,result_id,input->>'input_kind',(input->>'product_id')::uuid,(input->>'quality_id')::uuid,nullif(input->>'lot_id','')::uuid,
   coalesce((select l.lot_number from public.purchase_lots l where l.id=nullif(input->>'lot_id','')::uuid),''),(input->>'quantity')::numeric,p.unit_of_measure from public.products p where p.id=(input->>'product_id')::uuid;
 end loop;
 for output in select value from jsonb_array_elements(p_data->'outputs') loop
  if coalesce(output->>'output_kind','') not in ('main','byproduct','packed') or coalesce((output->>'quantity')::numeric,0)<=0 then raise exception 'Each output needs a valid type and positive quantity'; end if;
  if not exists(select 1 from public.products p join public.product_qualities q on q.product_id=p.id where p.id=(output->>'product_id')::uuid and p.organization_id=org and p.is_active and q.id=(output->>'quality_id')::uuid and q.is_active) then raise exception 'An output product or quality is invalid'; end if;
  if process='packing' and coalesce(output->>'output_kind','')<>'packed' then raise exception 'Packing orders must produce packaged products'; end if;
  if process='milling' and coalesce(output->>'output_kind','')='packed' then raise exception 'Milling orders cannot directly produce packed products'; end if;
  if process='packing' and (coalesce((output->>'package_size_kg')::numeric,0)<=0 or nullif(output->>'packaging_product_id','') is null or nullif(output->>'packaging_quality_id','') is null) then raise exception 'Each packed product needs bag size and packaging material'; end if;
  if process='packing' and not exists(select 1 from public.products p join public.product_qualities q on q.product_id=p.id where p.id=(output->>'packaging_product_id')::uuid and p.organization_id=org and p.is_active and q.id=(output->>'packaging_quality_id')::uuid and q.is_active) then raise exception 'A packaging product or quality is invalid'; end if;
  insert into public.manufacturing_order_outputs(organization_id,order_id,output_kind,product_id,quality_id,quantity,unit_of_measure,package_size_kg,packaging_product_id,packaging_quality_id,cost_share_percent)
  select org,result_id,output->>'output_kind',(output->>'product_id')::uuid,(output->>'quality_id')::uuid,(output->>'quantity')::numeric,p.unit_of_measure,
   nullif(output->>'package_size_kg','')::numeric,nullif(output->>'packaging_product_id','')::uuid,nullif(output->>'packaging_quality_id','')::uuid,coalesce((output->>'cost_share_percent')::numeric,0)
  from public.products p where p.id=(output->>'product_id')::uuid;
  if process='packing' then
   insert into public.manufacturing_order_inputs(organization_id,order_id,input_kind,product_id,quality_id,quantity,unit_of_measure)
   select org,result_id,'packaging',(output->>'packaging_product_id')::uuid,(output->>'packaging_quality_id')::uuid,(output->>'quantity')::numeric,p.unit_of_measure from public.products p where p.id=(output->>'packaging_product_id')::uuid;
  end if;
 end loop;
 return query select result_id,n;
end $$;

create function public.complete_manufacturing_order(p_order_id uuid)
returns table(order_id uuid,order_number text,status text,total_cost numeric)
language plpgsql security definer set search_path=public as $$
declare o public.manufacturing_orders; actor uuid; line record; out_line record; available numeric; stock_value numeric; unit numeric; line_cost numeric; material_total numeric:=0; process_cost numeric:=0; total numeric:=0; qty_basis numeric:=0; output_basis numeric:=0; assigned_share numeric; remain_share numeric; used_share numeric; movement uuid; lot uuid; lot_number text; source_type text; origin text; same_varieties integer; rice_input numeric; desired_rice numeric; bag_count numeric; lot_available numeric;
begin
 perform public.assert_business_operation('manufacturing');
 if not public.has_permission('manufacturing') and not public.has_permission('stock') then raise exception 'Manufacturing access required'; end if;
 select * into o from public.manufacturing_orders where id=p_order_id and organization_id=(public.current_profile()).organization_id for update;
 if not found then raise exception 'Production order not found'; end if;
 if o.status='completed' then return query select o.id,o.order_number,o.status,o.total_cost; return; end if;
 if o.status<>'draft' then raise exception 'Only draft production orders can be completed'; end if;
 if not public.can_access_center(o.center_id) then raise exception 'You cannot access this stock center'; end if;
 actor:=auth.uid();
 if not exists(select 1 from public.manufacturing_order_inputs where manufacturing_order_inputs.order_id=o.id) or not exists(select 1 from public.manufacturing_order_outputs where manufacturing_order_outputs.order_id=o.id) then raise exception 'Add production inputs and outputs before completing'; end if;
 if o.process_type='packing' then
  select count(distinct lower(trim(q.name))) into same_varieties from public.manufacturing_order_inputs i join public.product_qualities q on q.id=i.quality_id where i.order_id=o.id and i.input_kind='bulk_rice';
  if same_varieties<>1 then raise exception 'A packing run can use only one rice variety'; end if;
  select lower(trim(q.name)) into lot_number from public.manufacturing_order_inputs i join public.product_qualities q on q.id=i.quality_id where i.order_id=o.id and i.input_kind='bulk_rice' limit 1;
  if lower(trim(o.rice_variety))<>lot_number then raise exception 'The selected rice variety does not match the bulk rice lots'; end if;
  select coalesce(sum(quantity),0) into rice_input from public.manufacturing_order_inputs where order_id=o.id and input_kind='bulk_rice';
  select coalesce(sum(quantity*package_size_kg),0),coalesce(sum(quantity),0) into desired_rice,bag_count from public.manufacturing_order_outputs where order_id=o.id and output_kind='packed';
  if abs(rice_input-desired_rice)>0.001 then raise exception 'Bulk rice quantity must equal the total weight of the selected packages'; end if;
  if exists(select 1 from public.manufacturing_order_outputs x join public.product_qualities q on q.id=x.quality_id where x.order_id=o.id and lower(trim(q.name))<>lower(trim(o.rice_variety))) then raise exception 'Packed products must use the selected rice variety'; end if;
 end if;
 -- Lock every stock dimension before checking quantities, so concurrent production
 -- and sales cannot both consume the same remaining balance.
 for line in select distinct i.product_id,i.quality_id,o.location_id,o.organization_id from public.manufacturing_order_inputs i join public.manufacturing_orders o on o.id=i.order_id where i.order_id=p_order_id loop
  perform pg_advisory_xact_lock(hashtextextended(line.organization_id::text||line.product_id::text||line.quality_id::text||line.location_id::text,51));
 end loop;
 for line in select i.*,p.unit_of_measure from public.manufacturing_order_inputs i join public.products p on p.id=i.product_id where i.order_id=o.id order by i.created_at,i.id loop
  select coalesce(sum(case when m.movement_type in ('purchase_in','transfer_in','adjustment_in') then a.quantity else -a.quantity end),0),
         coalesce(sum(case when m.movement_type in ('purchase_in','transfer_in','adjustment_in') then a.quantity*m.unit_cost else -a.quantity*m.unit_cost end),0)
   into available,stock_value from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id
   where m.organization_id=o.organization_id and m.center_id=o.center_id and m.location_id=o.location_id and m.product_id=line.product_id and m.quality_id=line.quality_id;
  if line.lot_id is not null then
   select coalesce(sum(a.quantity),0) into lot_available from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id where m.organization_id=o.organization_id and m.center_id=o.center_id and m.location_id=o.location_id and m.product_id=line.product_id and m.quality_id=line.quality_id and a.lot_id=line.lot_id;
   if lot_available+0.0001<line.quantity then raise exception 'Insufficient stock in lot % (available %, required %)',line.lot_number,lot_available,line.quantity; end if;
  elsif available+0.0001<line.quantity then raise exception 'Insufficient stock for % (available %, required %)',line.product_id,available,line.quantity;
  end if;
  if available<=0 then raise exception 'No available stock for selected input'; end if;
 end loop;
 -- Snapshot actual input cost and post each consumption atomically.
 for line in select i.*,p.unit_of_measure from public.manufacturing_order_inputs i join public.products p on p.id=i.product_id where i.order_id=o.id order by i.created_at,i.id loop
  select coalesce(sum(case when m.movement_type in ('purchase_in','transfer_in','adjustment_in') then a.quantity else -a.quantity end),0),
         coalesce(sum(case when m.movement_type in ('purchase_in','transfer_in','adjustment_in') then a.quantity*m.unit_cost else -a.quantity*m.unit_cost end),0)
   into available,stock_value from public.stock_lot_allocations a join public.stock_movements m on m.id=a.movement_id
   where m.organization_id=o.organization_id and m.center_id=o.center_id and m.location_id=o.location_id and m.product_id=line.product_id and m.quality_id=line.quality_id;
  unit:=greatest(0,round(stock_value/nullif(available,0),2));line_cost:=round(unit*line.quantity,2);material_total:=material_total+line_cost;
  insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
  values(o.organization_id,o.center_id,o.location_id,line.product_id,line.quality_id,'adjustment_out',line.quantity,unit,case when o.process_type='packing' then 'packing_run' else 'manufacturing_order' end,o.id,actor) returning id into movement;
  if line.lot_id is not null then
   delete from public.stock_lot_allocations where movement_id=movement;
   insert into public.stock_lot_allocations(movement_id,lot_id,quantity,document_line_id) values(movement,line.lot_id,-line.quantity,line.id);
  else
   update public.stock_lot_allocations set document_line_id=line.id where movement_id=movement;
  end if;
  update public.manufacturing_order_inputs set unit_cost=unit,line_cost=line_cost,stock_movement_id=movement where id=line.id;
 end loop;
 if o.method='external' and o.process_type='milling' then
  select coalesce(sum(quantity),0) into qty_basis from public.manufacturing_order_inputs where order_id=o.id and input_kind='raw_material';
  if qty_basis<=0 then raise exception 'Add paddy input before completing milling'; end if;
  process_cost:=round(qty_basis*o.external_mill_fee_per_kg,2);
 else
  select coalesce(sum(quantity),0) into qty_basis from public.manufacturing_order_inputs where order_id=o.id and input_kind in ('raw_material','bulk_rice');
  process_cost:=case o.operation_cost_basis when 'per_kg' then round(qty_basis*o.operation_cost_rate,2) when 'per_hour' then round(o.operation_hours*o.operation_cost_rate,2) else o.operation_cost_rate end;
 end if;
 total:=round(material_total+process_cost,2);
 select coalesce(sum(case when o.process_type='packing' then x.quantity*x.package_size_kg else x.quantity end),0) into output_basis from public.manufacturing_order_outputs x where x.order_id=o.id;
 if output_basis<=0 then raise exception 'Enter valid output quantities'; end if;
 select coalesce(sum(cost_share_percent),0) into assigned_share from public.manufacturing_order_outputs where manufacturing_order_outputs.order_id=o.id;
 if assigned_share>0 and abs(assigned_share-100)>0.01 then raise exception 'Output cost shares must total 100 percent, or all be left at zero for proportional allocation'; end if;
 remain_share:=assigned_share;
 for out_line in select x.*,p.unit_of_measure from public.manufacturing_order_outputs x join public.products p on p.id=x.product_id where x.order_id=o.id order by x.created_at,x.id loop
  assigned_share:=case when remain_share=0 then (case when o.process_type='packing' then out_line.quantity*out_line.package_size_kg else out_line.quantity end)/output_basis*100 else out_line.cost_share_percent end;
  line_cost:=round(total*assigned_share/100,2);
  unit:=round(line_cost/nullif(out_line.quantity,0),2);
  source_type:=case when o.process_type='packing' then 'packing' else 'manufacturing' end;
  origin:=case when o.process_type='packing' then 'PKG-' else 'MFG-' end;
  lot_number:=origin||to_char(o.order_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_lot_number_seq')::text,8,'0');
  insert into public.purchase_lots(organization_id,product_id,quality_id,lot_number,created_by,source_type,source_order_id)
   values(o.organization_id,out_line.product_id,out_line.quality_id,lot_number,actor,source_type,o.id) returning id into lot;
  insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
  values(o.organization_id,o.center_id,o.location_id,out_line.product_id,out_line.quality_id,'adjustment_in',out_line.quantity,unit,case when o.process_type='packing' then 'packing_run' else 'manufacturing_order' end,o.id,actor) returning id into movement;
  update public.stock_lot_allocations set lot_id=lot,document_line_id=out_line.id where movement_id=movement and lot_id is null;
  update public.manufacturing_order_outputs set stock_lot_id=lot,lot_number=lot_number,unit_cost=unit,line_cost=line_cost,stock_movement_id=movement where id=out_line.id;
 end loop;
 update public.manufacturing_orders set status='completed',material_cost=material_total,operation_cost=process_cost,total_cost=total,completed_at=now(),completed_by=actor where id=o.id;
 return query select o.id,o.order_number,'completed'::text,total;
end $$;

revoke all on function public.save_manufacturing_recipe(uuid,jsonb),public.save_manufacturing_order(uuid,jsonb),public.complete_manufacturing_order(uuid) from public,anon;
grant execute on function public.save_manufacturing_recipe(uuid,jsonb),public.save_manufacturing_order(uuid,jsonb),public.complete_manufacturing_order(uuid) to authenticated;

commit;
