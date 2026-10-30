begin;
-- Catalogue additions must not disappear when editing an older business.
-- Materialize missing entries as disabled; never silently license optional modules.
insert into public.business_module_entitlements(organization_id,module_key,enabled)
select o.id,m.key,m.mandatory from public.organizations o cross join public.business_module_catalog m
on conflict(organization_id,module_key) do nothing;
do $$ declare d text;old_sql text;begin
 d:=pg_get_functiondef('public.platform_save_business(uuid,uuid,jsonb,jsonb,text[])'::regprocedure);
 old_sql:='update public.business_module_entitlements set enabled=(module_key=any(selected)),updated_at=now() where organization_id=p_org;';
 if position(old_sql in d)=0 then raise exception 'Platform entitlement save implementation marker missing';end if;
 d:=replace(d,old_sql,'insert into public.business_module_entitlements(organization_id,module_key,enabled,updated_at) select p_org,key,key=any(selected),now() from public.business_module_catalog on conflict(organization_id,module_key) do update set enabled=excluded.enabled,updated_at=excluded.updated_at;');
 execute d;
 d:=pg_get_functiondef('public.platform_grant_business_admin_access(uuid,uuid,uuid)'::regprocedure);
 if position('when ''manufacturing'' then' in d)=0 then
 d:=replace(d,'when ''dashboard'' then array[''dashboard'']','when ''manufacturing'' then array[''manufacturing''] when ''dashboard'' then array[''dashboard'']');
 if position('when ''manufacturing'' then' in d)=0 then raise exception 'Administrator permission mapping marker missing';end if;
 execute d;end if;
end $$;
-- pg_get_functiondef replacements preserve service-only ACLs and actor checks.
notify pgrst,'reload schema';
commit;
