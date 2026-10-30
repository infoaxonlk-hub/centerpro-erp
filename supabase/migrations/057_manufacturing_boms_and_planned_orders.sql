begin;
-- Extend the existing recipe registry. Old operation-only presets stay intact.
alter table public.manufacturing_recipes
 add column finished_product_id uuid references public.products,
 add column finished_quality_id uuid references public.product_qualities,
 add column finished_quantity numeric(18,3) check(finished_quantity>0),
 add column finished_unit text,
 add column production_center_id uuid references public.centers,
 add column source_location_id uuid references public.locations,
 add column destination_center_id uuid references public.centers,
 add column destination_location_id uuid references public.locations,
 add column package_size_kg numeric(12,3) check(package_size_kg>0),
 add column finished_cost_share numeric(7,4) not null default 0 check(finished_cost_share between 0 and 100),
 add column revision integer not null default 1;
create table public.manufacturing_bom_components(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 recipe_id uuid not null references public.manufacturing_recipes on delete cascade,
 product_id uuid not null references public.products,quality_id uuid not null references public.product_qualities,
 quantity numeric(18,3) not null check(quantity>0),unit text not null,
 input_kind text not null check(input_kind in ('raw_material','bulk_rice','packaging')),sequence integer not null
);
create table public.manufacturing_bom_byproducts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 recipe_id uuid not null references public.manufacturing_recipes on delete cascade,
 product_id uuid not null references public.products,quality_id uuid not null references public.product_qualities,
 quantity numeric(18,3) not null check(quantity>0),unit text not null,
 destination_center_id uuid not null references public.centers,destination_location_id uuid not null references public.locations,
 cost_share_percent numeric(7,4) not null default 0 check(cost_share_percent between 0 and 100),sequence integer not null
);
create table public.manufacturing_bom_operations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 recipe_id uuid not null references public.manufacturing_recipes on delete cascade,
 name text not null check(length(trim(name)) between 1 and 120),
 planned_quantity numeric(24,6) not null check(planned_quantity>=0),
 cost_basis text not null check(cost_basis in ('per_kg','per_hour','per_batch')),
 cost_rate numeric(18,2) not null check(cost_rate>=0),sequence integer not null
);
create index bom_component_recipe on public.manufacturing_bom_components(recipe_id,sequence);
create index bom_byproduct_recipe on public.manufacturing_bom_byproducts(recipe_id,sequence);
create index bom_operation_recipe on public.manufacturing_bom_operations(recipe_id,sequence);
alter table public.manufacturing_orders add column bom_snapshot jsonb,
 add column production_quantity numeric(18,3) check(production_quantity>0),
 add column process_loss_kg numeric(18,3) not null default 0 check(process_loss_kg>=0);
alter table public.manufacturing_orders alter column operation_cost_rate type numeric(24,6);
alter table public.manufacturing_order_inputs add column bom_component_key uuid,
 add column planned_quantity numeric(18,3) check(planned_quantity>=0),
 add column source_selection text not null default 'auto' check(source_selection in ('auto','lot','legacy'));
alter table public.manufacturing_order_inputs drop constraint manufacturing_order_inputs_quantity_check;
alter table public.manufacturing_order_inputs add check(quantity>=0);
alter table public.manufacturing_order_outputs add column bom_output_key text,
 add column planned_quantity numeric(18,3) check(planned_quantity>=0),
 add column destination_center_id uuid references public.centers,
 add column destination_location_id uuid references public.locations,
 add check((destination_center_id is null)=(destination_location_id is null));
create table public.manufacturing_order_operations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 order_id uuid not null references public.manufacturing_orders on delete cascade,bom_operation_key uuid not null,
 name text not null,planned_quantity numeric(24,6) not null check(planned_quantity>=0),actual_quantity numeric(24,6) not null check(actual_quantity>=0),
 cost_basis text not null check(cost_basis in ('per_kg','per_hour','per_batch')),cost_rate numeric(18,2) not null check(cost_rate>=0),
 computed_cost numeric(24,6) not null default 0,line_cost numeric(24,6) not null default 0,sequence integer not null,
 unique(order_id,bom_operation_key)
);

create function public.assert_manufacturing_location(p_center uuid,p_location uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.centers c join public.locations l on l.center_id=c.id
  where c.id=p_center and l.id=p_location and c.organization_id=(public.current_profile()).organization_id
  and c.is_active and l.is_active and public.can_access_center(c.id) for share of c,l;
 if not found then raise exception 'Select an active stock center/location in your business that you can access';end if;
end $$;
revoke all on function public.assert_manufacturing_location(uuid,uuid) from public,anon,authenticated;
create function public.manufacturing_bom_access(p_recipe uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.manufacturing_recipes r where r.id=p_recipe and r.organization_id=(public.current_profile()).organization_id
  and (r.production_center_id is null or (public.can_access_center(r.production_center_id) and public.can_access_center(r.destination_center_id)
   and not exists(select 1 from public.manufacturing_bom_byproducts b where b.recipe_id=r.id and not public.can_access_center(b.destination_center_id)))))
$$;
revoke all on function public.manufacturing_bom_access(uuid) from public,anon;
grant execute on function public.manufacturing_bom_access(uuid) to authenticated;
create policy bom_center_boundary on public.manufacturing_recipes as restrictive for select to authenticated using(public.manufacturing_bom_access(id));
do $$ declare t text;definition text;condition text;begin
 definition:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 definition:=replace(definition,'''manufacturing_cost_entries'') then return array[''manufacturing'']','''manufacturing_cost_entries'',''manufacturing_bom_components'',''manufacturing_bom_byproducts'',''manufacturing_bom_operations'',''manufacturing_order_operations'') then return array[''manufacturing'']');
 if position('manufacturing_order_operations' in definition)=0 then raise exception 'BoM module classification marker missing';end if;execute definition;
 foreach t in array array['manufacturing_bom_components','manufacturing_bom_byproducts','manufacturing_bom_operations','manufacturing_order_operations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
  condition:=case when t='manufacturing_order_operations' then 'exists(select 1 from public.manufacturing_orders o where o.id=order_id and public.can_access_center(o.center_id))' else 'public.manufacturing_bom_access(recipe_id)' end;
  execute format('create policy manufacturing_read on public.%I for select to authenticated using((public.has_permission(''manufacturing'') or public.has_permission(''stock'')) and %s)',t,condition);
  execute format('create policy tenant_boundary on public.%I as restrictive for all to authenticated using(organization_id=(public.current_profile()).organization_id) with check(organization_id=(public.current_profile()).organization_id)',t);
  execute format('create policy business_operation_boundary on public.%I as restrictive for all to authenticated using(public.business_table_access(%L,to_jsonb(%I),false)) with check(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t,t,t);
  execute format('create policy business_delete_boundary on public.%I as restrictive for delete to authenticated using(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t);
  execute format('create trigger tenant_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write()',t);
  execute format('create trigger business_operation_guard before insert or update or delete on public.%I for each row execute function public.enforce_business_operation()',t);
 end loop;
end $$;
create trigger completed_production_immutable before update or delete on public.manufacturing_order_operations for each row execute function public.protect_completed_production();

create function public.manufacturing_bom_document(p_recipe uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select to_jsonb(r)||jsonb_build_object(
  'finished_product_name',(select name from public.products where id=r.finished_product_id),'finished_quality_name',(select name from public.product_qualities where id=r.finished_quality_id),
  'source_name',(select c.name||' / '||l.name from public.centers c join public.locations l on l.center_id=c.id where c.id=r.production_center_id and l.id=r.source_location_id),
  'destination_name',(select c.name||' / '||l.name from public.centers c join public.locations l on l.center_id=c.id where c.id=r.destination_center_id and l.id=r.destination_location_id),
  'manufacturing_bom_components',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('product_name',p.name,'quality_name',q.name) order by c.sequence,c.id) from public.manufacturing_bom_components c join public.products p on p.id=c.product_id join public.product_qualities q on q.id=c.quality_id where c.recipe_id=r.id),'[]'::jsonb),
  'manufacturing_bom_byproducts',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('product_name',p.name,'quality_name',q.name,'destination_name',c.name||' / '||l.name) order by b.sequence,b.id) from public.manufacturing_bom_byproducts b join public.products p on p.id=b.product_id join public.product_qualities q on q.id=b.quality_id join public.centers c on c.id=b.destination_center_id join public.locations l on l.id=b.destination_location_id where b.recipe_id=r.id),'[]'::jsonb),
  'manufacturing_bom_operations',coalesce((select jsonb_agg(to_jsonb(o) order by o.sequence,o.id) from public.manufacturing_bom_operations o where o.recipe_id=r.id),'[]'::jsonb))
 from public.manufacturing_recipes r where r.id=p_recipe
$$;
revoke all on function public.manufacturing_bom_document(uuid) from public,anon,authenticated;

create function public.save_manufacturing_bom(p_recipe_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare org uuid:=(public.current_profile()).organization_id;rid uuid;code text;process text;fg public.products;q public.product_qualities;row jsonb;p public.products;seq integer;shares numeric;center uuid;source uuid;dest_center uuid;dest uuid;quantity numeric;
begin
 perform public.assert_business_operation('manufacturing');
 if not public.has_permission('manufacturing') and not public.has_permission('stock') then raise exception 'Manufacturing access required';end if;
 center:=(p_data->>'production_center_id')::uuid;source:=(p_data->>'source_location_id')::uuid;dest_center:=(p_data->>'destination_center_id')::uuid;dest:=(p_data->>'destination_location_id')::uuid;
 perform public.assert_manufacturing_location(center,source);perform public.assert_manufacturing_location(dest_center,dest);
 process:=p_data->>'process_type';if process not in ('milling','packing') then raise exception 'Valid BoM process required';end if;
 select * into fg from public.products where id=(p_data->>'finished_product_id')::uuid and organization_id=org and is_active and can_be_manufactured;
 select * into q from public.product_qualities where id=(p_data->>'finished_quality_id')::uuid and product_id=fg.id and is_active;
 if fg.id is null or q.id is null then raise exception 'Active manufacturable finished product and quality required';end if;
 quantity:=(p_data->>'finished_quantity')::numeric;if quantity is null or quantity<=0 or quantity<>round(quantity,3) then raise exception 'Positive BoM production quantity with up to three decimals required';end if;
 if coalesce(jsonb_typeof(p_data->'components'),'null')<>'array' or jsonb_array_length(p_data->'components')=0 then raise exception 'Add BoM components';end if;
 if coalesce(jsonb_typeof(p_data->'byproducts'),'null')<>'array' or coalesce(jsonb_typeof(p_data->'operations'),'null')<>'array' then raise exception 'BoM by-products and operations arrays required';end if;
 if jsonb_array_length(p_data->'components')>200 or jsonb_array_length(p_data->'byproducts')>200 or jsonb_array_length(p_data->'operations')>200 then raise exception 'A BoM supports up to 200 lines in each section';end if;
 if process='packing' and (coalesce((p_data->>'package_size_kg')::numeric,0)<=0 or quantity<>trunc(quantity) or jsonb_array_length(p_data->'byproducts')>0) then raise exception 'Packing requires a pack size, whole finished bag count and no by-products';end if;
 if length(btrim(coalesce(p_data->>'name',''))) not between 2 and 120 then raise exception 'BoM name required';end if;
 if p_recipe_id is null then
  code:=coalesce(nullif(upper(btrim(p_data->>'recipe_code')),''),'BOM-'||lpad(nextval('public.manufacturing_recipe_number_seq')::text,6,'0'));
  insert into public.manufacturing_recipes(organization_id,recipe_code,name,process_type,created_by) values(org,code,btrim(p_data->>'name'),process,auth.uid()) returning id into rid;
 else
  select id,recipe_code into rid,code from public.manufacturing_recipes where id=p_recipe_id and organization_id=org for update;
  if not found or not public.manufacturing_bom_access(rid) then raise exception 'BoM not found or center access denied';end if;
  code:=coalesce(nullif(upper(btrim(p_data->>'recipe_code')),''),code);
  update public.manufacturing_recipes set revision=revision+1 where id=rid;
 end if;
 if length(code) not between 1 and 60 then raise exception 'BoM code must contain 1 to 60 characters';end if;
 update public.manufacturing_recipes set recipe_code=code,name=btrim(p_data->>'name'),process_type=process,
  finished_product_id=fg.id,finished_quality_id=q.id,finished_quantity=quantity,finished_unit=fg.unit_of_measure,
  production_center_id=center,source_location_id=source,destination_center_id=dest_center,destination_location_id=dest,
  package_size_kg=case when process='packing' then (p_data->>'package_size_kg')::numeric else null end,
  rice_variety=case when process='packing' then q.name else left(coalesce(p_data->>'rice_variety',''),80) end,
  finished_cost_share=coalesce((p_data->>'finished_cost_share')::numeric,0),external_mill_fee_per_kg=coalesce((p_data->>'external_mill_fee_per_kg')::numeric,0),
  is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=rid;
 delete from public.manufacturing_bom_components where recipe_id=rid;delete from public.manufacturing_bom_byproducts where recipe_id=rid;delete from public.manufacturing_bom_operations where recipe_id=rid;
 seq:=0;
 for row in select value from jsonb_array_elements(p_data->'components') loop
  if row ? 'lot_id' or row ? 'lot_selection' or row ? 'source_selection' then raise exception 'Source lots belong on orders, not on the BoM';end if;
  select * into p from public.products where id=(row->>'product_id')::uuid and organization_id=org and is_active and (can_be_purchased or can_be_manufactured);
  if not found or not exists(select 1 from public.product_qualities where id=(row->>'quality_id')::uuid and product_id=p.id and is_active) then raise exception 'Invalid BoM component product/quality';end if;
  if (process='milling' and row->>'input_kind'<>'raw_material') or (process='packing' and row->>'input_kind' not in ('bulk_rice','packaging')) then raise exception 'Invalid component kind for this process';end if;
  if process='packing' and row->>'input_kind'='bulk_rice' and (p.unit_of_measure not in ('KG','G') or not exists(select 1 from public.product_qualities where id=(row->>'quality_id')::uuid and lower(trim(name))=lower(trim(q.name)))) then raise exception 'Packing components must use one rice variety and weight units';end if;
  if (row->>'quantity')::numeric<>round((row->>'quantity')::numeric,3) then raise exception 'Component quantity supports three decimals';end if;
  seq:=seq+1;insert into public.manufacturing_bom_components(organization_id,recipe_id,product_id,quality_id,quantity,unit,input_kind,sequence) values(org,rid,p.id,(row->>'quality_id')::uuid,(row->>'quantity')::numeric,p.unit_of_measure,row->>'input_kind',seq);
 end loop;
 if process='packing' and (not exists(select 1 from public.manufacturing_bom_components where recipe_id=rid and input_kind='bulk_rice') or not exists(select 1 from public.manufacturing_bom_components where recipe_id=rid and input_kind='packaging')) then raise exception 'Packing BoM needs bulk rice and packaging components';end if;
 seq:=0;
 for row in select value from jsonb_array_elements(p_data->'byproducts') loop
  select * into p from public.products where id=(row->>'product_id')::uuid and organization_id=org and is_active and can_be_manufactured;
  if not found or not exists(select 1 from public.product_qualities where id=(row->>'quality_id')::uuid and product_id=p.id and is_active) then raise exception 'Invalid by-product';end if;
  perform public.assert_manufacturing_location((row->>'destination_center_id')::uuid,(row->>'destination_location_id')::uuid);
  seq:=seq+1;insert into public.manufacturing_bom_byproducts(organization_id,recipe_id,product_id,quality_id,quantity,unit,destination_center_id,destination_location_id,cost_share_percent,sequence)
   values(org,rid,p.id,(row->>'quality_id')::uuid,(row->>'quantity')::numeric,p.unit_of_measure,(row->>'destination_center_id')::uuid,(row->>'destination_location_id')::uuid,coalesce((row->>'cost_share_percent')::numeric,0),seq);
 end loop;
 shares:=coalesce((p_data->>'finished_cost_share')::numeric,0)+(select coalesce(sum(cost_share_percent),0) from public.manufacturing_bom_byproducts where recipe_id=rid);
 if shares<>0 and shares<>100 then raise exception 'Output shares must total 100 percent or all be zero';end if;
 seq:=0;
 for row in select value from jsonb_array_elements(p_data->'operations') loop
  if row->>'cost_basis'='per_kg' and exists(select 1 from public.manufacturing_bom_components where recipe_id=rid and input_kind<>'packaging' and unit not in ('KG','G')) then raise exception 'Per-kg operations require KG/G component units';end if;
  seq:=seq+1;insert into public.manufacturing_bom_operations(organization_id,recipe_id,name,planned_quantity,cost_basis,cost_rate,sequence)
   values(org,rid,btrim(row->>'name'),case when row->>'cost_basis'='per_kg' then (select coalesce(sum(case when c.unit='G' then c.quantity/1000 else c.quantity end),0) from public.manufacturing_bom_components c where c.recipe_id=rid and c.input_kind<>'packaging') else (row->>'planned_quantity')::numeric end,row->>'cost_basis',(row->>'cost_rate')::numeric,seq);
 end loop;
 update public.manufacturing_recipes set operation_name=coalesce((select name from public.manufacturing_bom_operations where recipe_id=rid order by sequence limit 1),'Production'),operation_cost_basis=coalesce((select cost_basis from public.manufacturing_bom_operations where recipe_id=rid order by sequence limit 1),'per_batch'),operation_cost_rate=coalesce((select cost_rate from public.manufacturing_bom_operations where recipe_id=rid order by sequence limit 1),0) where id=rid;
 return public.manufacturing_bom_document(rid);
end $$;
revoke all on function public.save_manufacturing_bom(uuid,jsonb) from public,anon;
grant execute on function public.save_manufacturing_bom(uuid,jsonb) to authenticated;

alter table public.manufacturing_order_outputs drop constraint manufacturing_order_outputs_quantity_check;
alter table public.manufacturing_order_outputs add check(quantity>=0);
create unique index order_bom_component_once on public.manufacturing_order_inputs(order_id,bom_component_key) where bom_component_key is not null;
create unique index order_bom_output_once on public.manufacturing_order_outputs(order_id,bom_output_key) where bom_output_key is not null;

create function public.save_bom_manufacturing_order(p_order_id uuid,p_data jsonb)
returns table(order_id uuid,order_number text) language plpgsql security definer set search_path=public as $$
declare org uuid:=(public.current_profile()).organization_id;existing public.manufacturing_orders;rid uuid;doc jsonb;item jsonb;actual jsonb;key text;quantity numeric;factor numeric;planned numeric;actual_qty numeric;mode text;lot uuid;product public.products;primary_pack jsonb;n text;result uuid;v_method text;
begin
 perform public.assert_business_operation('manufacturing');if not public.has_permission('manufacturing') and not public.has_permission('stock') then raise exception 'Manufacturing access required';end if;
 if p_order_id is null then raise exception 'Stable order request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,52));
 select * into existing from public.manufacturing_orders where id=p_order_id for update;
 if found then
  if existing.organization_id<>org or not public.can_access_center(existing.center_id) then raise exception 'Production order access denied';end if;
  if existing.status='completed' then return query select existing.id,existing.order_number;return;end if;
  if existing.status<>'draft' then raise exception 'Only draft orders can be edited';end if;
 end if;
 rid:=(p_data->>'recipe_id')::uuid;
 if existing.recipe_id=rid and existing.bom_snapshot is not null and coalesce((p_data->>'bom_revision')::integer,(existing.bom_snapshot->>'revision')::integer)=(existing.bom_snapshot->>'revision')::integer then doc:=existing.bom_snapshot;
 else
  perform 1 from public.manufacturing_recipes where id=rid and organization_id=org and is_active and finished_product_id is not null for share;
  if not found or not public.manufacturing_bom_access(rid) then raise exception 'Active matching BoM with authorized centers required';end if;
  doc:=public.manufacturing_bom_document(rid);
  if (p_data->>'bom_revision')::integer is distinct from (doc->>'revision')::integer then raise exception 'BoM changed; reload it before saving';end if;
 end if;
 perform public.assert_manufacturing_location((doc->>'production_center_id')::uuid,(doc->>'source_location_id')::uuid);
 perform public.assert_manufacturing_location((doc->>'destination_center_id')::uuid,(doc->>'destination_location_id')::uuid);
 quantity:=(p_data->>'production_quantity')::numeric;
 if quantity is null or quantity<=0 or quantity<>round(quantity,3) or (doc->>'process_type'='packing' and quantity<>trunc(quantity)) then raise exception 'Positive production quantity required (whole bags for packing)';end if;
 if nullif(p_data->>'finished_product_id','')::uuid is distinct from (doc->>'finished_product_id')::uuid then raise exception 'Finished product does not match the BoM';end if;
 factor:=quantity/(doc->>'finished_quantity')::numeric;
 if coalesce(jsonb_typeof(p_data->'inputs'),'null')<>'array' or jsonb_array_length(p_data->'inputs')<>jsonb_array_length(doc->'manufacturing_bom_components')
  or coalesce(jsonb_typeof(p_data->'outputs'),'null')<>'array' or jsonb_array_length(p_data->'outputs')<>1+jsonb_array_length(doc->'manufacturing_bom_byproducts')
  or coalesce(jsonb_typeof(p_data->'operations'),'null')<>'array' or jsonb_array_length(p_data->'operations')<>jsonb_array_length(doc->'manufacturing_bom_operations') then raise exception 'Order lines must match the BoM snapshot';end if;
 v_method:=coalesce(p_data->>'method','own');if v_method not in ('own','external') or (doc->>'process_type'='packing' and v_method<>'own') then raise exception 'Invalid production method';end if;
 if v_method='external' and not exists(select 1 from public.suppliers where id=(p_data->>'supplier_id')::uuid and organization_id=org and is_active) then raise exception 'Active external mill supplier required';end if;
 if nullif(p_data->>'operation_expense_id','') is not null or nullif(p_data->>'external_expense_id','') is not null then
  perform public.assert_business_operation('expenses');if not public.has_permission('cash') then raise exception 'Expense access required';end if;
  if p_data->>'operation_expense_id'=p_data->>'external_expense_id' then raise exception 'An expense cannot be capitalized twice';end if;
  if exists(select 1 from unnest(array[nullif(p_data->>'operation_expense_id','')::uuid,nullif(p_data->>'external_expense_id','')::uuid]) e(id) where e.id is not null and not exists(select 1 from public.expenses x where x.id=e.id and x.organization_id=org and x.center_id=(doc->>'production_center_id')::uuid)) then raise exception 'Invalid production expense source';end if;
 end if;
 if existing.id is null then
  n:='MO-'||lpad(nextval('public.manufacturing_order_number_seq')::text,7,'0');
  insert into public.manufacturing_orders(id,organization_id,order_number,center_id,location_id,process_type,method,created_by)
   values(p_order_id,org,n,(doc->>'production_center_id')::uuid,(doc->>'source_location_id')::uuid,doc->>'process_type',v_method,auth.uid());
 else n:=existing.order_number;end if;
 result:=p_order_id;
 update public.manufacturing_orders set center_id=(doc->>'production_center_id')::uuid,location_id=(doc->>'source_location_id')::uuid,process_type=doc->>'process_type',method=v_method,
  recipe_id=rid,bom_snapshot=doc,production_quantity=quantity,rice_variety=doc->>'rice_variety',
  supplier_id=case when v_method='external' then (p_data->>'supplier_id')::uuid else null end,
  external_mill_fee_per_kg=(doc->>'external_mill_fee_per_kg')::numeric,operation_cost_basis='per_batch',operation_cost_rate=0,operation_hours=0,
  operation_expense_id=nullif(p_data->>'operation_expense_id','')::uuid,external_expense_id=nullif(p_data->>'external_expense_id','')::uuid,
  order_date=coalesce(nullif(p_data->>'order_date','')::date,(now() at time zone 'Asia/Colombo')::date),notes=left(coalesce(p_data->>'notes',''),1000) where id=result;
 delete from public.manufacturing_order_inputs where manufacturing_order_inputs.order_id=result;
 delete from public.manufacturing_order_outputs where manufacturing_order_outputs.order_id=result;
 delete from public.manufacturing_order_operations where manufacturing_order_operations.order_id=result;
 for item in select value from jsonb_array_elements(doc->'manufacturing_bom_components') loop
  key:=item->>'id';if (select count(*) from jsonb_array_elements(p_data->'inputs') x where x->>'bom_component_key'=key)<>1 then raise exception 'Missing or duplicate BoM component';end if;
  select x into actual from jsonb_array_elements(p_data->'inputs') x where x->>'bom_component_key'=key;
  if (actual ? 'product_id' and actual->>'product_id' is distinct from item->>'product_id') or (actual ? 'quality_id' and actual->>'quality_id' is distinct from item->>'quality_id') then raise exception 'Component identity is fixed by the BoM snapshot';end if;
  actual_qty:=(actual->>'quantity')::numeric;if actual_qty is null or actual_qty<0 or actual_qty<>round(actual_qty,3) then raise exception 'Actual component consumption must be nonnegative with three decimals';end if;
  select * into product from public.products where id=(item->>'product_id')::uuid and organization_id=org and is_active and (can_be_purchased or can_be_manufactured) and unit_of_measure=item->>'unit';
  if not found or not exists(select 1 from public.product_qualities where id=(item->>'quality_id')::uuid and product_id=product.id and is_active) then raise exception 'BoM component product/quality is inactive or its unit changed';end if;
  mode:=coalesce(actual->>'source_selection','auto');lot:=nullif(actual->>'lot_id','')::uuid;
  if mode not in ('auto','lot','legacy') or (mode='lot')<>(lot is not null) then raise exception 'Invalid component source selection';end if;
  if lot is not null and not exists(select 1 from public.purchase_lots where id=lot and organization_id=org and product_id=product.id and quality_id=(item->>'quality_id')::uuid) then raise exception 'Selected lot does not belong to this business/product/quality';end if;
  insert into public.manufacturing_order_inputs(organization_id,order_id,input_kind,product_id,quality_id,lot_id,lot_number,quantity,unit_of_measure,sack_count,bom_component_key,planned_quantity,source_selection)
   values(org,result,item->>'input_kind',product.id,(item->>'quality_id')::uuid,lot,case when lot is not null then (select lot_number from public.purchase_lots where id=lot) when mode='legacy' then 'Unassigned / Legacy' else 'Automatic oldest lots' end,actual_qty,item->>'unit',coalesce((actual->>'sack_count')::integer,0),key::uuid,round((item->>'quantity')::numeric*factor,3),mode);
 end loop;
 select x into primary_pack from jsonb_array_elements(doc->'manufacturing_bom_components') x where x->>'input_kind'='packaging' order by (x->>'sequence')::integer limit 1;
 for item in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('id','finished','product_id',doc->>'finished_product_id','quality_id',doc->>'finished_quality_id','quantity',quantity,'unit',doc->>'finished_unit','destination_center_id',doc->>'destination_center_id','destination_location_id',doc->>'destination_location_id','cost_share_percent',doc->>'finished_cost_share'))||coalesce((select jsonb_agg(b||jsonb_build_object('quantity',round((b->>'quantity')::numeric*factor,3))) from jsonb_array_elements(doc->'manufacturing_bom_byproducts') b),'[]'::jsonb)) loop
  key:=item->>'id';if (select count(*) from jsonb_array_elements(p_data->'outputs') x where x->>'bom_output_key'=key)<>1 then raise exception 'Missing or duplicate BoM output';end if;
  select x into actual from jsonb_array_elements(p_data->'outputs') x where x->>'bom_output_key'=key;
  if (actual ? 'destination_center_id' and actual->>'destination_center_id' is distinct from item->>'destination_center_id') or (actual ? 'destination_location_id' and actual->>'destination_location_id' is distinct from item->>'destination_location_id') then raise exception 'Output destination is fixed by the BoM snapshot';end if;
  if (actual ? 'product_id' and actual->>'product_id' is distinct from item->>'product_id') or (actual ? 'quality_id' and actual->>'quality_id' is distinct from item->>'quality_id') then raise exception 'Output identity is fixed by the BoM snapshot';end if;
  actual_qty:=(actual->>'quantity')::numeric;if actual_qty is null or actual_qty<0 or actual_qty<>round(actual_qty,3) or (key='finished' and actual_qty=0) then raise exception 'Actual finished output must be positive; by-product quantities must be nonnegative';end if;
  perform public.assert_manufacturing_location((item->>'destination_center_id')::uuid,(item->>'destination_location_id')::uuid);
  select * into product from public.products where id=(item->>'product_id')::uuid and organization_id=org and is_active and can_be_manufactured and unit_of_measure=item->>'unit';
  if not found or not exists(select 1 from public.product_qualities where id=(item->>'quality_id')::uuid and product_id=product.id and is_active) then raise exception 'BoM output is inactive or its unit changed';end if;
  insert into public.manufacturing_order_outputs(organization_id,order_id,output_kind,product_id,quality_id,quantity,unit_of_measure,package_size_kg,packaging_product_id,packaging_quality_id,cost_share_percent,sack_count,bom_output_key,planned_quantity,destination_center_id,destination_location_id)
   values(org,result,case when doc->>'process_type'='packing' then 'packed' when key='finished' then 'main' else 'byproduct' end,product.id,(item->>'quality_id')::uuid,actual_qty,item->>'unit',case when doc->>'process_type'='packing' then (doc->>'package_size_kg')::numeric end,
   (primary_pack->>'product_id')::uuid,(primary_pack->>'quality_id')::uuid,(item->>'cost_share_percent')::numeric,coalesce((actual->>'sack_count')::integer,0),key,(item->>'quantity')::numeric,(item->>'destination_center_id')::uuid,(item->>'destination_location_id')::uuid);
 end loop;
 for item in select value from jsonb_array_elements(doc->'manufacturing_bom_operations') loop
  key:=item->>'id';if (select count(*) from jsonb_array_elements(p_data->'operations') x where x->>'bom_operation_key'=key)<>1 then raise exception 'Missing or duplicate BoM operation';end if;
  select x into actual from jsonb_array_elements(p_data->'operations') x where x->>'bom_operation_key'=key;
  if actual ? 'cost_rate' and (actual->>'cost_rate')::numeric is distinct from (item->>'cost_rate')::numeric then raise exception 'Operation rates are fixed by the BoM snapshot';end if;
  actual_qty:=(actual->>'actual_quantity')::numeric;if actual_qty is null or actual_qty<0 or actual_qty<>round(actual_qty,6) then raise exception 'Actual operation consumption must be nonnegative with up to six decimals';end if;
  insert into public.manufacturing_order_operations(organization_id,order_id,bom_operation_key,name,planned_quantity,actual_quantity,cost_basis,cost_rate,sequence)
   values(org,result,key::uuid,item->>'name',round((item->>'planned_quantity')::numeric*factor,6),actual_qty,item->>'cost_basis',(item->>'cost_rate')::numeric,(item->>'sequence')::integer);
 end loop;
 return query select result,n;
end $$;
revoke all on function public.save_bom_manufacturing_order(uuid,jsonb) from public,anon;
grant execute on function public.save_bom_manufacturing_order(uuid,jsonb) to authenticated;

-- Database-level links agree with the RPC even for internal future writers.
create function public.guard_bom_relationships() returns trigger language plpgsql security definer set search_path=public as $$
declare org uuid;r public.manufacturing_recipes;begin
 if tg_table_name='manufacturing_order_operations' then
  select organization_id into org from public.manufacturing_orders where id=new.order_id;
  if org is distinct from new.organization_id then raise exception 'Operation order belongs to another business';end if;
 else
  select * into r from public.manufacturing_recipes where id=new.recipe_id;
  if r.organization_id is distinct from new.organization_id then raise exception 'BoM child belongs to another business';end if;
  if tg_table_name in ('manufacturing_bom_components','manufacturing_bom_byproducts') then
   if not exists(select 1 from public.products p join public.product_qualities q on q.product_id=p.id where p.id=new.product_id and q.id=new.quality_id and p.organization_id=new.organization_id and p.unit_of_measure=new.unit) then raise exception 'BoM product/quality/unit ownership mismatch';end if;
  end if;
  if tg_table_name='manufacturing_bom_byproducts' then
   if not exists(select 1 from public.centers c join public.locations l on l.center_id=c.id where c.id=new.destination_center_id and l.id=new.destination_location_id and c.organization_id=new.organization_id) then raise exception 'By-product destination ownership mismatch';end if;
  end if;
 end if;return new;
end $$;
revoke all on function public.guard_bom_relationships() from public,anon,authenticated;
create trigger bom_relationship_guard before insert or update on public.manufacturing_bom_components for each row execute function public.guard_bom_relationships();
create trigger bom_relationship_guard before insert or update on public.manufacturing_bom_byproducts for each row execute function public.guard_bom_relationships();
create trigger bom_relationship_guard before insert or update on public.manufacturing_bom_operations for each row execute function public.guard_bom_relationships();
create trigger bom_relationship_guard before insert or update on public.manufacturing_order_operations for each row execute function public.guard_bom_relationships();

-- Keep old operation-only orders usable, but never let the legacy RPC erase a
-- structured order's plans, component consumption or configured destinations.
alter function public.save_manufacturing_order(uuid,jsonb) rename to save_manufacturing_order_legacy;
revoke all on function public.save_manufacturing_order_legacy(uuid,jsonb) from public,anon,authenticated;
create function public.save_manufacturing_order(p_order_id uuid,p_data jsonb)
returns table(order_id uuid,order_number text) language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.manufacturing_orders where id=p_order_id and organization_id=(public.current_profile()).organization_id and bom_snapshot is not null)
 or (exists(select 1 from public.manufacturing_recipes where id=nullif(p_data->>'recipe_id','')::uuid and organization_id=(public.current_profile()).organization_id and finished_product_id is not null)
  and not exists(select 1 from public.manufacturing_orders where id=p_order_id and organization_id=(public.current_profile()).organization_id and bom_snapshot is null and recipe_id=nullif(p_data->>'recipe_id','')::uuid)) then raise exception 'Use the BoM manufacturing order workflow';end if;
 return query select * from public.save_manufacturing_order_legacy(p_order_id,p_data);
end $$;
revoke all on function public.save_manufacturing_order(uuid,jsonb) from public,anon;
grant execute on function public.save_manufacturing_order(uuid,jsonb) to authenticated;
alter function public.save_manufacturing_recipe(uuid,jsonb) rename to save_manufacturing_recipe_legacy;
revoke all on function public.save_manufacturing_recipe_legacy(uuid,jsonb) from public,anon,authenticated;
create function public.save_manufacturing_recipe(p_recipe_id uuid,p_data jsonb)
returns table(recipe_id uuid,recipe_code text) language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.manufacturing_recipes where id=p_recipe_id and organization_id=(public.current_profile()).organization_id and finished_product_id is not null) then raise exception 'Edit structured recipes through the BoM service';end if;
 return query select * from public.save_manufacturing_recipe_legacy(p_recipe_id,p_data);
end $$;
revoke all on function public.save_manufacturing_recipe(uuid,jsonb) from public,anon;
grant execute on function public.save_manufacturing_recipe(uuid,jsonb) to authenticated;

create function public.prepare_bom_completion(p_order uuid) returns void language plpgsql security definer set search_path=public as $$
declare o public.manufacturing_orders;op record;qty numeric;computed numeric;total numeric:=0;expense_amount numeric;allocated numeric:=0;line numeric;idx integer:=0;cnt integer;
begin
 select * into o from public.manufacturing_orders where id=p_order;
 if o.bom_snapshot is null then return;end if;
 perform 1 from public.products p join public.product_qualities q on q.product_id=p.id
  where (p.id,q.id) in (select i.product_id,i.quality_id from public.manufacturing_order_inputs i where i.order_id=o.id union select x.product_id,x.quality_id from public.manufacturing_order_outputs x where x.order_id=o.id)
  order by p.id,q.id for share of p,q;
 perform public.assert_manufacturing_location(o.center_id,o.location_id);
 if o.center_id<>(o.bom_snapshot->>'production_center_id')::uuid or o.location_id<>(o.bom_snapshot->>'source_location_id')::uuid then raise exception 'Production source differs from its BoM snapshot';end if;
 for op in select * from public.manufacturing_order_outputs where order_id=o.id loop perform public.assert_manufacturing_location(op.destination_center_id,op.destination_location_id);end loop;
 if not exists(select 1 from public.manufacturing_order_inputs where order_id=o.id and quantity>0) then raise exception 'Record actual component consumption before completing';end if;
 if exists(select 1 from public.manufacturing_order_inputs i join public.products p on p.id=i.product_id where i.order_id=o.id and i.quantity>0 and p.tracks_purchase_lots and i.source_selection='auto') then raise exception 'Select the actual source lot or explicit Legacy stock for every tracked component';end if;
 if exists(select 1 from public.manufacturing_order_outputs where order_id=o.id and quantity=0 and cost_share_percent>0) then raise exception 'A positive output cost share needs a positive accepted quantity';end if;
 if o.process_type='packing' and not exists(select 1 from public.manufacturing_order_inputs where order_id=o.id and input_kind='packaging' and quantity>0) then raise exception 'Record actual packaging consumption';end if;
 select coalesce(sum(case when unit_of_measure='G' then quantity/1000 else quantity end),0) into qty from public.manufacturing_order_inputs where order_id=o.id and input_kind in ('raw_material','bulk_rice');
 for op in select * from public.manufacturing_order_operations where order_id=o.id order by sequence,id loop
  if op.cost_basis='per_kg' then
   if exists(select 1 from public.manufacturing_order_inputs where order_id=o.id and input_kind in ('raw_material','bulk_rice') and unit_of_measure not in ('KG','G')) then raise exception 'Per-kg operations require weight-based components';end if;
   update public.manufacturing_order_operations set actual_quantity=round(qty,6) where id=op.id;
   computed:=round(qty*op.cost_rate,6);
  else computed:=round(op.actual_quantity*op.cost_rate,6);end if;
  update public.manufacturing_order_operations set computed_cost=computed,line_cost=computed where id=op.id;total:=total+computed;
 end loop;
 if o.operation_expense_id is not null then
  perform public.assert_business_operation('expenses');if not public.has_permission('cash') then raise exception 'Expense access required';end if;
  select amount into expense_amount from public.expenses where id=o.operation_expense_id and organization_id=o.organization_id and center_id=o.center_id;
  if not found then raise exception 'Invalid operation expense source';end if;
  select count(*) into cnt from public.manufacturing_order_operations where order_id=o.id;
  if cnt=0 then raise exception 'An operation expense requires a BoM operation';end if;
  for op in select * from public.manufacturing_order_operations where order_id=o.id order by sequence,id loop
   idx:=idx+1;line:=case when idx=cnt then expense_amount-allocated else least(expense_amount-allocated,round(expense_amount*case when total=0 then 1.0/cnt else op.computed_cost/total end,6)) end;
   update public.manufacturing_order_operations set line_cost=line where id=op.id;allocated:=allocated+line;
  end loop;
 end if;
 update public.manufacturing_orders set operation_cost_basis='per_batch',operation_cost_rate=total where id=o.id;
end $$;
revoke all on function public.prepare_bom_completion(uuid) from public,anon,authenticated;

-- Extend the proven 056 transaction instead of replacing its costing engine.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.complete_manufacturing_order(uuid)'::regprocedure);
 definition:=replace(definition,' perform 1 from public.centers where id=v_order.center_id and is_active for update;', $code$
 perform 1 from public.centers c where c.id in (select v_order.center_id union select coalesce(x.destination_center_id,v_order.center_id) from public.manufacturing_order_outputs x where x.order_id=v_order.id) order by c.id for update;
 perform public.prepare_bom_completion(v_order.id);
 select * into v_order from public.manufacturing_orders where id=v_order.id;
 perform 1 from public.centers where id=v_order.center_id and is_active for update;
 $code$);
 if position('prepare_bom_completion' in definition)=0 then raise exception 'Completion integration marker missing';end if;
 definition:=replace(definition,'if v_input<=0 or abs(v_input-v_weight)>0.001 then', 'if v_input<=0 or (v_order.bom_snapshot is null and abs(v_input-v_weight)>0.001) or (v_order.bom_snapshot is not null and v_input<v_weight) then');
 definition:=replace(definition,'for item in select i.* from public.manufacturing_order_inputs i where i.order_id=v_order.id order by', 'for item in select i.* from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.quantity>0 order by');
 definition:=replace(definition,'from public.manufacturing_order_outputs x where x.order_id=v_order.id;', 'from public.manufacturing_order_outputs x where x.order_id=v_order.id and x.quantity>0;');
 definition:=replace(definition,'for produced in select x.* from public.manufacturing_order_outputs x where x.order_id=v_order.id order by', 'for produced in select x.* from public.manufacturing_order_outputs x where x.order_id=v_order.id and x.quantity>0 order by');
 definition:=replace(definition,'v_order.organization_id,v_order.center_id,v_order.location_id,produced.product_id','v_order.organization_id,coalesce(produced.destination_center_id,v_order.center_id),coalesce(produced.destination_location_id,v_order.location_id),produced.product_id');
 definition:=replace(definition,'set status=''completed'',valuation_method=', 'set status=''completed'',process_loss_kg=case when v_order.bom_snapshot is not null and v_order.process_type=''packing'' then greatest(0,v_input-v_weight) else 0 end,valuation_method=');
 -- v_weight later holds accepted packed weight; v_input still holds actual rice KG.
 execute definition;
 definition:=pg_get_functiondef('public.allocate_stock_lots()'::regprocedure);
 definition:=replace(definition,'if original is not null then', 'if original is not null or exists(select 1 from public.manufacturing_order_inputs i where i.id=document_line and i.source_selection=''legacy'') then');
 execute definition;
end $$;

notify pgrst,'reload schema';
commit;
