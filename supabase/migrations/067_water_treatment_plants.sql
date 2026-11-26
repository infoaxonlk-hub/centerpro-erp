begin;

-- The composite key lets plant records enforce customer, organization and
-- Center consistency with a database foreign key.
alter table public.customers
  add constraint customers_id_organization_center_key
  unique (id, organization_id, center_id);

create sequence public.water_treatment_plant_code_seq;

create table public.water_treatment_plants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  customer_id uuid not null,
  center_id uuid not null,
  plant_code text not null,
  serial_number text,
  plant_type text not null check (length(trim(plant_type)) between 1 and 100),
  manufacturer text,
  model text,
  capacity numeric(18,3) check (capacity is null or capacity > 0),
  capacity_unit text,
  installation_date date,
  site_address text not null check (length(trim(site_address)) between 1 and 1000),
  status text not null default 'active' check (status in ('active','inactive','decommissioned')),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, plant_code),
  unique (id, organization_id, center_id),
  foreign key (customer_id, organization_id, center_id)
    references public.customers(id, organization_id, center_id) on update restrict on delete restrict,
  check ((capacity is null) = (capacity_unit is null)),
  check (capacity_unit is null or length(trim(capacity_unit)) between 1 and 40)
);

create index water_treatment_plants_customer_idx
  on public.water_treatment_plants(organization_id, customer_id, status);
create index water_treatment_plants_center_idx
  on public.water_treatment_plants(organization_id, center_id, status);
create index water_treatment_plants_serial_idx
  on public.water_treatment_plants(organization_id, serial_number)
  where serial_number is not null;

create table public.water_treatment_plant_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  plant_id uuid not null,
  center_id uuid not null,
  record_type text not null check (record_type in ('installation','service','repair','maintenance','inspection')),
  occurred_at timestamptz not null default now(),
  summary text not null check (length(trim(summary)) between 1 and 200),
  details text,
  next_service_date date,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (plant_id, organization_id, center_id)
    references public.water_treatment_plants(id, organization_id, center_id) on update restrict on delete restrict
);

create index water_treatment_plant_history_plant_date_idx
  on public.water_treatment_plant_history(organization_id, plant_id, occurred_at desc, id desc);
create index water_treatment_plant_history_center_date_idx
  on public.water_treatment_plant_history(organization_id, center_id, occurred_at desc);

create function public.assign_water_treatment_plant_code()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.plant_code:='WT-'||lpad(nextval('public.water_treatment_plant_code_seq')::text,10,'0');
  return new;
end $$;
revoke all on function public.assign_water_treatment_plant_code() from public,anon,authenticated;
create trigger water_treatment_plant_code_before_insert
  before insert on public.water_treatment_plants
  for each row execute function public.assign_water_treatment_plant_code();

create function public.protect_water_treatment_plant_audit_fields()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.plant_code is distinct from old.plant_code
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Plant identity and audit fields cannot be changed';
  end if;
  return new;
end $$;
create trigger water_treatment_plant_audit_fields_immutable
  before update on public.water_treatment_plants
  for each row execute function public.protect_water_treatment_plant_audit_fields();

create function public.set_water_treatment_plant_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at:=now();
  return new;
end $$;
create trigger water_treatment_plant_updated_at
  before update on public.water_treatment_plants
  for each row execute function public.set_water_treatment_plant_updated_at();

create function public.reject_water_treatment_history_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Plant history is append-only; record a correction as a new entry';
end $$;
revoke all on function public.reject_water_treatment_history_mutation() from public,anon,authenticated;
create trigger water_treatment_plant_history_immutable
  before update or delete on public.water_treatment_plant_history
  for each row execute function public.reject_water_treatment_history_mutation();

alter table public.water_treatment_plants enable row level security;
alter table public.water_treatment_plant_history enable row level security;
revoke all on public.water_treatment_plants,public.water_treatment_plant_history from public,anon,authenticated;
grant select,insert,update on public.water_treatment_plants to authenticated;
grant select,insert on public.water_treatment_plant_history to authenticated;

create policy water_treatment_plants_read on public.water_treatment_plants
  for select to authenticated using (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.business_module_enabled(organization_id,'water_treatment')
    and public.can_access_center(center_id)
  );
create policy water_treatment_plants_insert on public.water_treatment_plants
  for insert to authenticated with check (
    organization_id=(public.current_profile()).organization_id
    and created_by=auth.uid()
    and public.has_permission('water_treatment')
    and public.business_module_enabled(organization_id,'water_treatment')
    and public.can_access_center(center_id)
  );
create policy water_treatment_plants_update on public.water_treatment_plants
  for update to authenticated using (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.business_module_enabled(organization_id,'water_treatment')
    and public.can_access_center(center_id)
  ) with check (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.business_module_enabled(organization_id,'water_treatment')
    and public.can_access_center(center_id)
  );
create policy water_treatment_plant_history_read on public.water_treatment_plant_history
  for select to authenticated using (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.business_module_enabled(organization_id,'water_treatment')
    and public.can_access_center(center_id)
  );
create policy water_treatment_plant_history_insert on public.water_treatment_plant_history
  for insert to authenticated with check (
    organization_id=(public.current_profile()).organization_id
    and recorded_by=auth.uid()
    and public.has_permission('water_treatment')
    and public.business_module_enabled(organization_id,'water_treatment')
    and public.can_access_center(center_id)
  );

do $$ declare t text; definition text; marker text; replacement text; begin
  definition:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
  marker:='if p_table=''customers'' then return array[''sales'',''farm_services'']; end if;';
  replacement:='if p_table in (''water_treatment_plants'',''water_treatment_plant_history'') then return array[''water_treatment'']; end if;'||chr(10)||
    ' if p_table=''customers'' then return case when p_write then array[''sales'',''farm_services''] else array[''sales'',''farm_services'',''water_treatment''] end; end if;';
  if position(marker in definition)=0 then raise exception 'Water Treatment table access insertion marker missing'; end if;
  definition:=replace(definition,marker,replacement);
  if position('water_treatment_plant_history' in definition)=0
    or position('array[''sales'',''farm_services'',''water_treatment'']' in definition)=0 then
    raise exception 'Water Treatment table access mapping marker missing';
  end if;
  execute definition;

  foreach t in array array['water_treatment_plants','water_treatment_plant_history'] loop
    execute format('create policy tenant_boundary on public.%I as restrictive for all to authenticated using(organization_id=(public.current_profile()).organization_id) with check(organization_id=(public.current_profile()).organization_id)',t);
    execute format('create policy business_operation_boundary on public.%I as restrictive for all to authenticated using(public.business_table_access(%L,to_jsonb(%I),false)) with check(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t,t,t);
    execute format('create policy business_delete_boundary on public.%I as restrictive for delete to authenticated using(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t);
    execute format('create trigger tenant_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write()',t);
    execute format('create trigger business_operation_guard before insert or update or delete on public.%I for each row execute function public.enforce_business_operation()',t);
  end loop;
end $$;

create policy water_treatment_customer_read on public.customers
  for select to authenticated using (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.business_module_enabled(organization_id,'water_treatment')
    and public.can_access_center(center_id)
  );

commit;
