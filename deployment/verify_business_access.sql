-- Read-only platform deployment verification. Run as a trusted SQL Editor operator.
select o.id,o.name,o.business_status,s.plan,s.status,s.starts_on,s.expires_on,s.trial_ends_on,
 public.business_operational(o.id) operational,
 (select count(*) from public.business_module_entitlements e where e.organization_id=o.id and e.enabled) enabled_modules
from public.organizations o join public.business_subscriptions s on s.organization_id=o.id order by o.created_at;

select key,name,parent_key,mandatory from public.business_module_catalog order by key;

select c.relname,p.polname,p.polpermissive from pg_policy p join pg_class c on c.oid=p.polrelid
join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
and p.polname in ('tenant_boundary','business_operation_boundary','business_delete_boundary')
order by c.relname,p.polname;

select c.relname,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
and t.tgname in ('tenant_write_guard','business_operation_guard','business_status_guard')
order by c.relname,t.tgname;

select p.proname,pg_get_function_identity_arguments(p.oid) arguments,
 has_function_privilege('authenticated',p.oid,'execute') business_user_can_execute,
 has_function_privilege('service_role',p.oid,'execute') service_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
and p.proname in ('platform_save_business','platform_provision_business','platform_grant_business_admin_access','_labor_post_expense','current_business_access')
order by p.proname;
