begin;

-- Keep business operators in their own organization, including business admins.
create or replace function public.can_access_center(target_center uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists (
   select 1 from public.profiles p join public.centers c on c.organization_id=p.organization_id
   where p.id=auth.uid() and p.is_active and c.id=target_center
   and (p.role in ('super_admin','admin') or exists (
     select 1 from public.user_center_access a where a.user_id=p.id and a.center_id=c.id))
 )
$$;

-- Resolve inherited ownership for child tables from their foreign keys.
-- No client-supplied relation names or SQL fragments are executed.
create function public._tenant_row_organization(p_table regclass,p_row jsonb,p_depth integer default 0)
returns uuid language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare r record; parent jsonb; result uuid;
begin
 if p_depth>8 then raise exception 'Tenant ownership recursion exceeded'; end if;
 if p_table='public.organizations'::regclass then return (p_row->>'id')::uuid; end if;
 if p_row ? 'organization_id' then return (p_row->>'organization_id')::uuid; end if;
 for r in
   select c.confrelid,a.attname child_column,b.attname parent_column,format_type(b.atttypid,b.atttypmod) parent_type
   from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
   join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1]
   join pg_class t on t.oid=c.confrelid join pg_namespace n on n.oid=t.relnamespace
   where c.contype='f' and c.conrelid=p_table and cardinality(c.conkey)=1 and n.nspname='public'
   order by (t.relname='profiles'), c.oid
 loop
   if p_row->>r.child_column is null then continue; end if;
   execute format('select to_jsonb(t) from %s t where %I=$1::%s',r.confrelid::regclass,r.parent_column,r.parent_type)
     into parent using p_row->>r.child_column;
   if parent is not null then
     result:=public._tenant_row_organization(r.confrelid,parent,p_depth+1);
     if result is not null then return result; end if;
   end if;
 end loop;
 return null;
end $$;
revoke all on function public._tenant_row_organization(regclass,jsonb,integer) from public,anon;
revoke all on function public._tenant_row_organization(regclass,jsonb,integer) from authenticated;
grant execute on function public._tenant_row_organization(regclass,jsonb,integer) to service_role;

create function public.tenant_row_organization(p_table regclass,p_row jsonb)
returns uuid language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare org uuid; actor public.profiles;
begin
 actor:=public.current_profile();
 if not coalesce(actor.is_active,false) then return null; end if;
 -- Restrict relation lookup to ordinary tables owned by this application.
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.oid=p_table and n.nspname='public' and c.relkind='r') then return null; end if;
 org:=public._tenant_row_organization(p_table,p_row);
 if org=actor.organization_id then return org; end if;
 return null;
end $$;
revoke all on function public.tenant_row_organization(regclass,jsonb) from public,anon;
grant execute on function public.tenant_row_organization(regclass,jsonb) to authenticated,service_role;

-- This restrictive policy is ANDed with existing permission/center policies.
-- Existing permissive admin policies can no longer bypass business ownership.
do $$
declare t record; condition text;
begin
 for t in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'
 loop
   condition:=format('public.tenant_row_organization(%L::regclass,to_jsonb(%I))=(public.current_profile()).organization_id and (public.current_profile()).is_active', 'public.'||t.relname,t.relname);
   execute format('alter table public.%I enable row level security',t.relname);
   execute format('create policy tenant_boundary on public.%I as restrictive for all to authenticated using (%s) with check (%s)',t.relname,condition,condition);
 end loop;
end $$;

-- Check writes even inside SECURITY DEFINER RPCs, and reject cross-business FKs.
create function public.enforce_tenant_write()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare row_data jsonb; org uuid; old_org uuid; actor public.profiles; r record; parent jsonb; parent_org uuid;
begin
 row_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 org:=public._tenant_row_organization(TG_RELID,row_data);
 if auth.uid() is not null then
   actor:=public.current_profile();
   if not coalesce(actor.is_active,false) or org is distinct from actor.organization_id then
     raise exception 'Business access denied' using errcode='42501';
   end if;
 end if;
 if TG_OP='UPDATE' then
   old_org:=public._tenant_row_organization(TG_RELID,to_jsonb(old));
   if old_org is distinct from org then raise exception 'Business ownership cannot be changed'; end if;
 end if;
 if TG_TABLE_NAME='profiles' and auth.uid() is not null then
   raise exception 'Use the user management service to change profiles' using errcode='42501';
 end if;
 if TG_OP<>'DELETE' then
   for r in
     select c.confrelid,
       (select string_agg(format('t.%I=($1->>%L)::%s',b.attname,a.attname,format_type(b.atttypid,b.atttypmod)),' and ')
        from generate_subscripts(c.conkey,1) s(i)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[s.i]
        join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[s.i]) predicate,
       (select array_agg(a.attname::text) from unnest(c.conkey) k(num)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num) child_columns
     from pg_constraint c
     join pg_class t on t.oid=c.confrelid join pg_namespace n on n.oid=t.relnamespace
     where c.contype='f' and c.conrelid=TG_RELID and n.nspname='public'
   loop
     if exists(select 1 from unnest(r.child_columns) col where row_data->>col is null) then continue; end if;
     execute format('select to_jsonb(t) from %s t where %s',r.confrelid::regclass,r.predicate)
       into parent using row_data;
     parent_org:=public._tenant_row_organization(r.confrelid,parent);
     -- A platform operator may appear as the provisioning audit actor.
     if TG_TABLE_NAME='audit_logs' and 'actor_id'=any(r.child_columns) and parent->>'role'='super_admin' then continue; end if;
     if parent is not null and parent_org is distinct from org then
       raise exception 'Related record belongs to another business' using errcode='23514';
     end if;
   end loop;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.enforce_tenant_write() from public,anon,authenticated;
do $$
declare t record;
begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'
 loop
   execute format('create trigger tenant_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write()',t.relname);
 end loop;
end $$;

-- Internal posting helpers must never be callable directly through the public API.
revoke all on function public.ensure_cash_accounts(uuid,uuid) from public,anon,authenticated;
revoke all on function public.cash_post_entry(uuid,text,text,uuid,numeric,text,uuid,text,text,timestamptz) from public,anon,authenticated;
commit;
