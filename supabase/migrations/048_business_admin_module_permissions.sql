begin;
do $$
begin
 if to_regprocedure('public.platform_assert_actor(uuid)') is null then
   raise exception 'Run business management migrations 045, 046 and 047 first';
 end if;
end $$;

-- An explicit platform action, separate from changing business entitlements.
-- Ordinary module saves never expand a user's role/permissions.
create function public.platform_grant_business_admin_access(p_actor uuid,p_org uuid,p_admin uuid)
returns text[] language plpgsql security definer set search_path=public as $$
declare target public.profiles; granted text[]; merged text[];
begin
 perform public.platform_assert_actor(p_actor);
 perform id from public.organizations where id=p_org for update;
 if not found then raise exception 'Business not found' using errcode='P0002'; end if;
 select * into target from public.profiles
 where id=p_admin and organization_id=p_org and role='admin' and is_active for update;
 if not found then raise exception 'Active business administrator not found' using errcode='P0002'; end if;

 select coalesce(array_agg(distinct permission order by permission),'{}'::text[]) into granted
 from public.business_module_entitlements e
 cross join lateral unnest(case e.module_key
   when 'dashboard' then array['dashboard']
   when 'purchases' then array['purchases']
   when 'sales' then array['sales']
   when 'inventory' then array['stock']
   when 'stock_transfers' then array['stock']
   when 'stock_adjustments' then array['stock','stock_adjustment']
   when 'labor' then array['labor']
   when 'cash' then array['cash']
   when 'bank' then array['cash']
   when 'expenses' then array['cash']
   when 'payment_reports' then array['payment_reports']
   when 'cheques' then array['payment_reports']
   when 'customer_receivables' then array['sales']
   when 'supplier_payables' then array['purchases','payment_reports']
   when 'centers' then array['centers']
   when 'masters' then array['masters','product_create','product_edit']
   when 'users' then array['users']
   when 'audit' then array['audit']
   else '{}'::text[] end) permission
 where e.organization_id=p_org and e.enabled
 and public.business_module_enabled(p_org,e.module_key);

 select array_agg(distinct permission order by permission) into merged
 from unnest(coalesce(target.permissions,'{}'::text[])||granted) permission;
 if merged is distinct from target.permissions then
   update public.profiles set permissions=merged,updated_at=now()
   where id=p_admin and organization_id=p_org and role='admin' and is_active;
   insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data)
   values(p_org,p_actor,'business_admin_access_granted','profile',p_admin::text,
     jsonb_build_object('permissions',target.permissions),
     jsonb_build_object('permissions',merged,'granted_for_enabled_modules',granted));
 end if;
 return merged;
end $$;
revoke all on function public.platform_grant_business_admin_access(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_grant_business_admin_access(uuid,uuid,uuid) to service_role;

-- Include safe own-profile changes so the existing session monitor refreshes
-- navigation after an administrator's permissions change, not just licence changes.
create or replace function public.current_business_access() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p public.profiles; o public.organizations; s public.business_subscriptions; modules jsonb;
begin
 p:=public.current_profile();
 if not coalesce(p.is_active,false) then raise exception 'Account access denied' using errcode='42501'; end if;
 select * into o from public.organizations where id=p.organization_id;
 select * into s from public.business_subscriptions where organization_id=p.organization_id;
 select coalesce(jsonb_agg(module_key order by module_key),'[]'::jsonb) into modules
 from public.business_module_entitlements where organization_id=p.organization_id and enabled;
 return jsonb_build_object('organizationId',o.id,'businessName',o.name,'businessStatus',o.business_status,
 'operational',public.business_operational(o.id),'reason',
 case when o.business_status<>'active' then 'suspended' when not public.business_operational(o.id) then 'subscription' else null end,
 'enabledModules',modules,'userPermissions',p.permissions,'userRole',p.role,
 'subscription',jsonb_build_object('plan',s.plan,'status',s.status,
 'starts_on',s.starts_on,'expires_on',s.expires_on,'trial_ends_on',s.trial_ends_on));
end $$;
revoke all on function public.current_business_access() from public,anon;
grant execute on function public.current_business_access() to authenticated;
commit;
