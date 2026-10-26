begin;
create function public.platform_assert_actor(p_actor uuid) returns void
language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='super_admin' and is_active) then
 raise exception 'Platform authorization required' using errcode='42501'; end if;
end $$;

create function public.platform_save_business(p_actor uuid,p_org uuid,p_details jsonb,p_subscription jsonb,p_modules text[])
returns uuid language plpgsql security definer set search_path=public as $$
declare before_org jsonb; before_sub jsonb; after_sub jsonb; before_modules jsonb; selected text[];
begin
 perform public.platform_assert_actor(p_actor);
 select to_jsonb(o) into before_org from public.organizations o where id=p_org for update;
 if before_org is null then raise exception 'Business not found' using errcode='P0002'; end if;
 selected:=array(select distinct unnest(array_append(coalesce(p_modules,'{}'::text[]),'dashboard')));
 if exists(select 1 from unnest(selected) k where not exists(select 1 from public.business_module_catalog where key=k))
 then raise exception 'Invalid module selection' using errcode='22023'; end if;
 if exists(select 1 from public.business_module_catalog where key=any(selected) and parent_key is not null and not(parent_key=any(selected)))
 then raise exception 'Required parent module must be enabled' using errcode='22023'; end if;
 if length(trim(p_details->>'name')) not between 2 and 120 or p_details->>'status' not in ('active','suspended')
 then raise exception 'Invalid business details' using errcode='22023'; end if;
 if p_subscription->>'status'='trialing' and nullif(p_subscription->>'trial_ends_on','') is null
 then raise exception 'Trial end date required' using errcode='22023'; end if;
 select to_jsonb(s)-'updated_at' into before_sub from public.business_subscriptions s where organization_id=p_org;
 select jsonb_agg(module_key order by module_key) into before_modules from public.business_module_entitlements where organization_id=p_org and enabled;
 update public.organizations set name=trim(p_details->>'name'),business_status=p_details->>'status',
 receipt_address=nullif(trim(p_details->>'address'),''),receipt_phone=nullif(trim(p_details->>'phone'),''),
 receipt_email=nullif(trim(p_details->>'email'),''),updated_at=now() where id=p_org;
 update public.business_subscriptions set plan=p_subscription->>'plan',status=p_subscription->>'status',
 starts_on=(p_subscription->>'starts_on')::date,expires_on=nullif(p_subscription->>'expires_on','')::date,
 trial_ends_on=nullif(p_subscription->>'trial_ends_on','')::date,admin_notes=coalesce(p_subscription->>'admin_notes',''),
 updated_at=now() where organization_id=p_org;
 update public.business_module_entitlements set enabled=(module_key=any(selected)),updated_at=now() where organization_id=p_org;
 select to_jsonb(s)-'updated_at' into after_sub from public.business_subscriptions s where organization_id=p_org;
 if before_sub is distinct from after_sub then
 insert into public.business_subscription_history(organization_id,actor_id,before_data,after_data) values(p_org,p_actor,before_sub,after_sub);
 end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data)
 values(p_org,p_actor,'business_configuration_updated','organization',p_org::text,
 jsonb_build_object('name',before_org->>'name','status',before_org->>'business_status','modules',before_modules,'subscription',before_sub-'admin_notes'),
 jsonb_build_object('name',trim(p_details->>'name'),'status',p_details->>'status','modules',selected,'subscription',after_sub-'admin_notes'));
 return p_org;
end $$;

create function public.platform_provision_business(p_actor uuid,p_admin uuid,p_admin_name text,p_admin_email text,
 p_permissions text[],p_details jsonb,p_subscription jsonb,p_modules text[])
returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid;
begin
 perform public.platform_assert_actor(p_actor);
 insert into public.organizations(name) values(trim(p_details->>'name')) returning id into org;
 insert into public.profiles(id,organization_id,full_name,email,role,permissions)
 values(p_admin,org,p_admin_name,p_admin_email,'admin',p_permissions);
 perform public.platform_save_business(p_actor,org,p_details,p_subscription,p_modules);
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
 values(org,p_actor,'business_created','organization',org::text,jsonb_build_object('admin_id',p_admin,'admin_email',p_admin_email));
 return org;
end $$;

-- These RPCs are server-service only; actor IDs must come from verified sessions.
revoke all on function public.platform_assert_actor(uuid),
 public.platform_save_business(uuid,uuid,jsonb,jsonb,text[]),
 public.platform_provision_business(uuid,uuid,text,text,text[],jsonb,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.platform_save_business(uuid,uuid,jsonb,jsonb,text[]),
 public.platform_provision_business(uuid,uuid,text,text,text[],jsonb,jsonb,text[]) to service_role;
commit;
