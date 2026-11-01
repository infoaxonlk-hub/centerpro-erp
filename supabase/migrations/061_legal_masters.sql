begin;

-- Legal data is optional. No historical document, balance or posting is changed.
do $$ declare t text;begin
 foreach t in array array['customers','suppliers','organizations'] loop
  execute format('alter table public.%I add column registered_name text check(length(registered_name)<=200), add column trading_name text check(length(trading_name)<=200), add column legal_email text check(length(legal_email)<=254), add column business_registration_number text check(length(business_registration_number)<=80), add column tin text check(length(tin)<=40), add column payment_terms_days integer check(payment_terms_days between 0 and 3650), add column payment_terms_note text check(length(payment_terms_note)<=500)',t);
 end loop;
end $$;

do $$ declare t text;begin
 foreach t in array array['customers','suppliers','organizations'] loop
  execute format('alter table public.%I add column legal_revision integer not null default 0',t);
 end loop;
end $$;

create function public.legal_master_access(p_kind text,p_id uuid,p_edit boolean default false)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare org uuid;cid uuid;begin
 if not coalesce((public.current_profile()).is_active,false) or not public.business_operational((public.current_profile()).organization_id) then return false;end if;
 if p_edit and not public.is_admin() then return false;end if;
 if p_kind='customer' then
  select organization_id,center_id into org,cid from public.customers where id=p_id;
  return coalesce(org=(public.current_profile()).organization_id and public.can_access_center(cid) and (public.sales_center_access(cid) and public.business_module_enabled(org,'sales') or public.farm_center_access(cid)),false);
 elsif p_kind='supplier' then
  select organization_id into org from public.suppliers where id=p_id;
  return coalesce(org=(public.current_profile()).organization_id and public.business_table_access('suppliers',jsonb_build_object('organization_id',org),p_edit),false);
 elsif p_kind='business' then
  return coalesce(p_id=(public.current_profile()).organization_id and public.is_admin() and public.has_permission('users') and public.business_module_enabled(p_id,'users'),false);
 end if;return false;
end $$;
revoke all on function public.legal_master_access(text,uuid,boolean) from public,anon;
grant execute on function public.legal_master_access(text,uuid,boolean) to authenticated;

create table public.legal_addresses(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 customer_id uuid references public.customers,supplier_id uuid references public.suppliers,issuer_id uuid references public.organizations,
 kind text not null check(kind in ('billing','delivery','registered')),is_default boolean not null default false,
 line1 text not null check(length(trim(line1)) between 1 and 200),line2 text check(length(line2)<=200),
 city text check(length(city)<=100),district text check(length(district)<=100),province text check(length(province)<=100),
 postal_code text check(length(postal_code)<=20),country_code text not null default 'LK' check(country_code ~ '^[A-Z]{2}$'),
 created_at timestamptz not null default now(),check(num_nonnulls(customer_id,supplier_id,issuer_id)=1),check(issuer_id is null or issuer_id=organization_id)
);
create unique index legal_address_default on public.legal_addresses(organization_id,coalesce(customer_id,supplier_id,issuer_id),(case when customer_id is not null then 'customer' when supplier_id is not null then 'supplier' else 'business' end),kind) where is_default;
create index legal_address_customer on public.legal_addresses(customer_id);
create index legal_address_supplier on public.legal_addresses(supplier_id);
create table public.legal_vat_registrations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 customer_id uuid references public.customers,supplier_id uuid references public.suppliers,issuer_id uuid references public.organizations,
 status text not null check(status in ('registered','not_registered','unknown')),registration_number text check(length(registration_number)<=80),
 valid_from date not null,valid_to date,created_at timestamptz not null default now(),
 check(num_nonnulls(customer_id,supplier_id,issuer_id)=1),check(issuer_id is null or issuer_id=organization_id),
 check(isfinite(valid_from) and (valid_to is null or (isfinite(valid_to) and valid_to>valid_from))),
 check((status='registered' and length(trim(registration_number))>0 and registration_number is not null) or (status<>'registered' and registration_number is null))
);
create index legal_vat_owner on public.legal_vat_registrations(organization_id,coalesce(customer_id,supplier_id,issuer_id),valid_from);

-- Serialized per master, including SECURITY DEFINER writes. Typed FKs are also
-- checked by enforce_tenant_write; an owner cannot be moved between businesses.
create function public.legal_child_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare k text;owner uuid;begin
 k:=case when new.customer_id is not null then 'customer' when new.supplier_id is not null then 'supplier' else 'business' end;
 owner:=coalesce(new.customer_id,new.supplier_id,new.issuer_id);
 if auth.uid() is not null and not public.legal_master_access(k,owner,true) then raise exception 'legal.access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||owner::text,61));
 if tg_table_name='legal_vat_registrations' then
  if exists(select 1 from public.legal_vat_registrations r where r.organization_id=new.organization_id and coalesce(r.customer_id,r.supplier_id,r.issuer_id)=owner and (case when r.customer_id is not null then 'customer' when r.supplier_id is not null then 'supplier' else 'business' end)=k and r.id<>new.id and daterange(r.valid_from,r.valid_to,'[)') && daterange(new.valid_from,new.valid_to,'[)')) then raise exception 'legal.vat_overlap' using errcode='23514';end if;
 end if;return new;
end $$;
revoke all on function public.legal_child_guard() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['legal_addresses','legal_vat_registrations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy tenant_boundary on public.%I as restrictive for all to authenticated using(organization_id=(public.current_profile()).organization_id) with check(organization_id=(public.current_profile()).organization_id)',t);
  execute format('create policy legal_read on public.%I for select to authenticated using(public.legal_master_access(case when customer_id is not null then ''customer'' when supplier_id is not null then ''supplier'' else ''business'' end,coalesce(customer_id,supplier_id,issuer_id),false))',t);
  execute format('create trigger tenant_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write()',t);
  execute format('create trigger business_operation_guard before insert or update or delete on public.%I for each row execute function public.enforce_business_operation()',t);
  execute format('create trigger legal_child_guard before insert or update on public.%I for each row execute function public.legal_child_guard()',t);
 end loop;
end $$;

-- Protect optional legal columns even through older direct supplier/company APIs.
create function public.protect_legal_master_fields() returns trigger language plpgsql security definer set search_path=public as $$
declare k text;changed boolean;begin
 k:=case tg_table_name when 'customers' then 'customer' when 'suppliers' then 'supplier' else 'business' end;
 if tg_op='INSERT' then
  changed:=new.legal_revision<>0 or new.registered_name is not null or new.trading_name is not null or new.legal_email is not null or new.business_registration_number is not null or new.tin is not null or new.payment_terms_days is not null or new.payment_terms_note is not null;
 else changed:=row(new.legal_revision,new.registered_name,new.trading_name,new.legal_email,new.business_registration_number,new.tin,new.payment_terms_days,new.payment_terms_note) is distinct from row(old.legal_revision,old.registered_name,old.trading_name,old.legal_email,old.business_registration_number,old.tin,old.payment_terms_days,old.payment_terms_note);
 end if;
 if changed then
  if not public.is_admin() or (tg_op='UPDATE' and not public.legal_master_access(k,old.id,true)) then raise exception 'legal.access_denied' using errcode='42501';end if;
  if new.legal_email is not null and new.legal_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'legal.invalid_email' using errcode='23514';end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(case when k='business' then new.id else (to_jsonb(new)->>'organization_id')::uuid end,auth.uid(),'legal_fields_changed',k,new.id::text,jsonb_build_object('fields',array['registered_name','trading_name','legal_email','business_registration_number','tin','payment_terms_days','payment_terms_note']));
 end if;
 if tg_op='UPDATE' and (changed or new.name is distinct from old.name) then new.legal_revision:=old.legal_revision+1;end if;
 return new;
end $$;
revoke all on function public.protect_legal_master_fields() from public,anon,authenticated;
create trigger legal_fields_guard before insert or update on public.customers for each row execute function public.protect_legal_master_fields();
create trigger legal_fields_guard before insert or update on public.suppliers for each row execute function public.protect_legal_master_fields();
create trigger legal_fields_guard before insert or update on public.organizations for each row execute function public.protect_legal_master_fields();

-- Return an allowlist, never bank details, internal notes or an entire master row.
create function public.read_legal_master(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb;t text;begin
 if not public.legal_master_access(p_kind,p_id,false) then raise exception 'legal.access_denied' using errcode='42501';end if;
 t:=case p_kind when 'customer' then 'customers' when 'supplier' then 'suppliers' when 'business' then 'organizations' end;
 execute format('select jsonb_build_object(''id'',id,''name'',name,''legal_revision'',legal_revision,''registered_name'',registered_name,''trading_name'',trading_name,''legal_email'',legal_email,''business_registration_number'',business_registration_number,''tin'',tin,''payment_terms_days'',payment_terms_days,''payment_terms_note'',payment_terms_note) from public.%I where id=$1',t) into r using p_id;
 return r||jsonb_build_object('can_edit',public.legal_master_access(p_kind,p_id,true),
 'addresses',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'is_default',a.is_default,'line1',a.line1,'line2',a.line2,'city',a.city,'district',a.district,'province',a.province,'postal_code',a.postal_code,'country_code',a.country_code) order by a.kind,a.is_default desc,a.created_at,a.id),'[]') from public.legal_addresses a where coalesce(a.customer_id,a.supplier_id,a.issuer_id)=p_id and (case when a.customer_id is not null then 'customer' when a.supplier_id is not null then 'supplier' else 'business' end)=p_kind and a.organization_id=(public.current_profile()).organization_id),
 'vat_registrations',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'status',v.status,'registration_number',v.registration_number,'valid_from',v.valid_from,'valid_to',v.valid_to) order by v.valid_from,v.id),'[]') from public.legal_vat_registrations v where coalesce(v.customer_id,v.supplier_id,v.issuer_id)=p_id and (case when v.customer_id is not null then 'customer' when v.supplier_id is not null then 'supplier' else 'business' end)=p_kind and v.organization_id=(public.current_profile()).organization_id));
end $$;
revoke all on function public.read_legal_master(text,uuid) from public,anon;
grant execute on function public.read_legal_master(text,uuid) to authenticated;

create function public.save_legal_master(p_kind text,p_id uuid,p_data jsonb,p_center uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid:=p_id;org uuid:=(public.current_profile()).organization_id;t text;item jsonb;revision integer;name text:=trim(p_data->>'name');begin
 if p_kind not in ('customer','supplier','business') or p_kind is null or jsonb_typeof(p_data)<>'object' or p_data is null then raise exception 'legal.invalid_data';end if;
 if p_id is null then
  -- Quick creation remains the existing APIs. Full legal editing is admin-only.
  if not public.is_admin() then raise exception 'legal.access_denied' using errcode='42501';end if;
  if p_kind='customer' then
   if not (public.sales_center_access(p_center) and public.business_module_enabled(org,'sales') or public.farm_center_access(p_center)) then raise exception 'legal.access_denied' using errcode='42501';end if;
   insert into public.customers(organization_id,center_id,name,created_by) values(org,p_center,name,auth.uid()) returning id into result;
  elsif p_kind='supplier' then
   if not public.business_table_access('suppliers',jsonb_build_object('organization_id',org),true) then raise exception 'legal.access_denied' using errcode='42501';end if;
   insert into public.suppliers(organization_id,name) values(org,name) returning id into result;
  else raise exception 'legal.access_denied' using errcode='42501';end if;
 end if;
 if not public.legal_master_access(p_kind,result,true) then raise exception 'legal.access_denied' using errcode='42501';end if;
 if name is null or length(name) not between 1 and 120 then raise exception 'legal.invalid_name';end if;
 t:=case p_kind when 'customer' then 'customers' when 'supplier' then 'suppliers' else 'organizations' end;
 -- Parent row lock serializes complete edits and snapshot reads across all child sets.
 execute format('select legal_revision from public.%I where id=$1 for update',t) into revision using result;
 if p_id is not null and (p_data->>'legal_revision')::integer is distinct from revision then raise exception 'legal.conflict' using errcode='40001';end if;
 execute format('update public.%I set name=$2,legal_revision=legal_revision+1,registered_name=nullif(trim($3->>''registered_name''),''''),trading_name=nullif(trim($3->>''trading_name''),''''),legal_email=nullif(trim($3->>''legal_email''),''''),business_registration_number=nullif(trim($3->>''business_registration_number''),''''),tin=nullif(trim($3->>''tin''),''''),payment_terms_days=nullif($3->>''payment_terms_days'','''')::integer,payment_terms_note=nullif(trim($3->>''payment_terms_note''),'''') where id=$1',t) using result,name,p_data;
 if jsonb_typeof(p_data->'addresses') is distinct from 'array' or jsonb_typeof(p_data->'vat_registrations') is distinct from 'array' or jsonb_array_length(p_data->'addresses')>50 or jsonb_array_length(p_data->'vat_registrations')>100 then raise exception 'legal.invalid_data';end if;
 delete from public.legal_addresses where organization_id=org and coalesce(customer_id,supplier_id,issuer_id)=result and (case when customer_id is not null then 'customer' when supplier_id is not null then 'supplier' else 'business' end)=p_kind;
 for item in select value from jsonb_array_elements(p_data->'addresses') loop
  insert into public.legal_addresses(organization_id,customer_id,supplier_id,issuer_id,kind,is_default,line1,line2,city,district,province,postal_code,country_code)
  values(org,case when p_kind='customer' then result end,case when p_kind='supplier' then result end,case when p_kind='business' then result end,item->>'kind',coalesce((item->>'is_default')::boolean,false),trim(item->>'line1'),nullif(trim(item->>'line2'),''),nullif(trim(item->>'city'),''),nullif(trim(item->>'district'),''),nullif(trim(item->>'province'),''),nullif(trim(item->>'postal_code'),''),upper(coalesce(nullif(trim(item->>'country_code'),''),'LK')));
 end loop;
 delete from public.legal_vat_registrations where organization_id=org and coalesce(customer_id,supplier_id,issuer_id)=result and (case when customer_id is not null then 'customer' when supplier_id is not null then 'supplier' else 'business' end)=p_kind;
 for item in select value from jsonb_array_elements(p_data->'vat_registrations') loop
  insert into public.legal_vat_registrations(organization_id,customer_id,supplier_id,issuer_id,status,registration_number,valid_from,valid_to)
  values(org,case when p_kind='customer' then result end,case when p_kind='supplier' then result end,case when p_kind='business' then result end,item->>'status',nullif(trim(item->>'registration_number'),''),(item->>'valid_from')::date,nullif(item->>'valid_to','')::date);
 end loop;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'legal_master_saved',p_kind,result::text,jsonb_build_object('address_count',jsonb_array_length(p_data->'addresses'),'vat_period_count',jsonb_array_length(p_data->'vat_registrations')));
 return result;
end $$;
revoke all on function public.save_legal_master(text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_legal_master(text,uuid,jsonb,uuid) to authenticated;

-- Pure data snapshot: callers must store this value with the future posted
-- document, never look it up again on reprint. No current invoice is backfilled.
create function public.build_legal_snapshot(p_kind text,p_id uuid,p_date date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb;selected jsonb:='{}';k text;address jsonb;vat jsonb;begin
 if p_date is null or not isfinite(p_date) then raise exception 'legal.invalid_date';end if;
 r:=public.read_legal_master(p_kind,p_id);
 foreach k in array array['billing','delivery','registered'] loop
  select a into address from jsonb_array_elements(r->'addresses') a where a->>'kind'=k order by (a->>'is_default')::boolean desc,(a-'id')::text,a->>'id' limit 1;
  selected:=selected||jsonb_build_object(k,address);
 end loop;
 select v into vat from jsonb_array_elements(r->'vat_registrations') v where (v->>'valid_from')::date<=p_date and (v->>'valid_to' is null or p_date<(v->>'valid_to')::date) limit 1;
 return jsonb_build_object('schema_version',1,'source_kind',p_kind,'source_id',p_id,'as_of',p_date,'party',r-'addresses'-'vat_registrations'-'can_edit','addresses',selected,'vat',coalesce(vat,jsonb_build_object('status','unknown')));
end $$;
revoke all on function public.build_legal_snapshot(text,uuid,date) from public,anon;
grant execute on function public.build_legal_snapshot(text,uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
