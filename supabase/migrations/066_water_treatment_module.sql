begin;

insert into public.business_module_catalog(key,name,parent_key,mandatory)
values('water_treatment','Water Treatment','inventory',false)
on conflict(key) do update set name=excluded.name,parent_key=excluded.parent_key,mandatory=excluded.mandatory;

-- Preserve existing module entitlements; existing organizations receive this
-- new module disabled only when they do not already have an entitlement row.
insert into public.business_module_entitlements(organization_id,module_key,enabled)
select id,'water_treatment',false from public.organizations
on conflict(organization_id,module_key) do nothing;

do $$
declare
 definition text;
 marker text;
 replacement text;
begin
 definition:=pg_get_functiondef('public.initialize_business_access()'::regprocedure);
 marker:='select new.id,key,true from public.business_module_catalog;';
 replacement:='select new.id,key,key<>''water_treatment'' from public.business_module_catalog;';
 if position(marker in definition)=0 then
  raise exception 'Business access initializer default marker missing';
 end if;
 definition:=replace(definition,marker,replacement);
 if position(replacement in definition)=0 then
  raise exception 'Business access initializer replacement marker missing';
 end if;
 execute definition;

 definition:=pg_get_functiondef('public.business_module_user_allowed(text)'::regprocedure);
 marker:='when ''farm_services'' then ''farm_services''=any(p.permissions) when ''audit'' then';
 replacement:='when ''water_treatment'' then ''water_treatment''=any(p.permissions) when ''farm_services'' then ''farm_services''=any(p.permissions) when ''audit'' then';
 if position(marker in definition)=0 then
  raise exception 'Business module user permission marker missing';
 end if;
 definition:=replace(definition,marker,replacement);
 if position('when ''water_treatment'' then ''water_treatment''=any(p.permissions)' in definition)=0 then
  raise exception 'Water Treatment user permission mapping marker missing';
 end if;
 execute definition;

 definition:=pg_get_functiondef('public.platform_grant_business_admin_access(uuid,uuid,uuid)'::regprocedure);
 marker:='when ''farm_services'' then array[''farm_services'',''farm_services_manage''] when ''dashboard'' then array[''dashboard'']';
 replacement:='when ''water_treatment'' then array[''water_treatment''] when ''farm_services'' then array[''farm_services'',''farm_services_manage''] when ''dashboard'' then array[''dashboard'']';
 if position(marker in definition)=0 then
  raise exception 'Platform business admin permission marker missing';
 end if;
 definition:=replace(definition,marker,replacement);
 if position('when ''water_treatment'' then array[''water_treatment'']' in definition)=0 then
  raise exception 'Water Treatment administrator permission mapping marker missing';
 end if;
 execute definition;
end $$;

commit;
