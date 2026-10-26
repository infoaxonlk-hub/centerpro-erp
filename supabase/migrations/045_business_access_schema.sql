begin;
alter table public.organizations add column business_status text not null default 'active'
  check (business_status ~ '^[a-z][a-z0-9_]{0,39}$');

create table public.business_module_catalog (
 key text primary key, name text not null, parent_key text references public.business_module_catalog(key),
 mandatory boolean not null default false
);
insert into public.business_module_catalog(key,name,mandatory) values
 ('dashboard','Dashboard',true),('purchases','Purchases',false),('sales','Sales',false),
 ('inventory','Inventory / Stock',false),('stock_transfers','Stock Transfers',false),
 ('stock_adjustments','Stock Adjustments',false),('labor','Labor & Sessions',false),
 ('cash','Cash Management',false),('bank','Bank Management',false),('expenses','Expenses',false),
 ('payment_reports','Payment Reports',false),('cheques','Cheque Management',false),
 ('customer_receivables','Customer Receivables',false),('supplier_payables','Supplier Payables',false),
 ('centers','Centers & Locations',false),('masters','Products & Suppliers',false),
 ('users','Users & Access',false),('audit','Audit Log',false);
update public.business_module_catalog set parent_key='inventory' where key in ('stock_transfers','stock_adjustments');
update public.business_module_catalog set parent_key='sales' where key='customer_receivables';
-- Existing labor payments are posted through create_center_expense.
update public.business_module_catalog set parent_key='expenses' where key='labor';

create table public.business_subscriptions (
 organization_id uuid primary key references public.organizations(id),
 plan text not null default 'Custom' check(plan in ('Starter','Professional','Enterprise','Custom')),
 status text not null default 'active' check(status in ('trialing','active','past_due','expired','cancelled')),
 starts_on date not null default current_date, expires_on date, trial_ends_on date,
 admin_notes text not null default '' check(length(admin_notes)<=4000),
 updated_at timestamptz not null default now(),
 check(expires_on is null or expires_on>=starts_on),
 check(trial_ends_on is null or trial_ends_on>=starts_on)
);
create table public.business_module_entitlements (
 organization_id uuid not null references public.organizations(id),
 module_key text not null references public.business_module_catalog(key),
 enabled boolean not null default false, updated_at timestamptz not null default now(),
 primary key(organization_id,module_key)
);
create table public.business_subscription_history (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),
 before_data jsonb, after_data jsonb not null, created_at timestamptz not null default now()
);
create index business_history_org_date on public.business_subscription_history(organization_id,created_at desc);
create index business_subscription_expiry on public.business_subscriptions(expires_on);
create index businesses_status on public.organizations(business_status);
-- Grandfather every existing organization: no expiry and all currently available modules.
insert into public.business_subscriptions(organization_id) select id from public.organizations;
insert into public.business_module_entitlements(organization_id,module_key,enabled)
 select o.id,m.key,true from public.organizations o cross join public.business_module_catalog m;

-- Trusted SQL provisioning retains legacy defaults. The platform API replaces these
-- atomically with the explicitly selected modules before its creation transaction commits.
create function public.initialize_business_access() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.business_subscriptions(organization_id) values(new.id);
 insert into public.business_module_entitlements(organization_id,module_key,enabled)
   select new.id,key,true from public.business_module_catalog;
 return new;
end $$;
create trigger initialize_business_access after insert on public.organizations
 for each row execute function public.initialize_business_access();
revoke all on function public.initialize_business_access() from public,anon,authenticated;

alter table public.business_module_catalog enable row level security;
alter table public.business_subscriptions enable row level security;
alter table public.business_module_entitlements enable row level security;
alter table public.business_subscription_history enable row level security;
revoke all on public.business_module_catalog,public.business_subscriptions,
 public.business_module_entitlements,public.business_subscription_history from anon,authenticated;
grant select on public.business_module_catalog,public.business_module_entitlements to authenticated;
grant select(organization_id,plan,status,starts_on,expires_on,trial_ends_on,updated_at) on public.business_subscriptions to authenticated;
create policy module_catalog_read on public.business_module_catalog for select to authenticated
 using ((public.current_profile()).is_active);
create policy subscription_read on public.business_subscriptions for select to authenticated
 using(organization_id=(public.current_profile()).organization_id and (public.current_profile()).is_active);
create policy entitlement_read on public.business_module_entitlements for select to authenticated
 using(organization_id=(public.current_profile()).organization_id and (public.current_profile()).is_active);
grant all on public.business_module_catalog,public.business_subscriptions,
 public.business_module_entitlements,public.business_subscription_history to service_role;
grant usage,select on sequence public.business_subscription_history_id_seq to service_role;

create function public.business_operational(p_org uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.organizations o join public.business_subscriptions s on s.organization_id=o.id
 where o.id=p_org and o.business_status='active'
 and s.status in ('active','trialing') and s.starts_on<=(now() at time zone 'Asia/Colombo')::date
 and (s.expires_on is null or s.expires_on>=(now() at time zone 'Asia/Colombo')::date)
 and (s.status<>'trialing' or (s.trial_ends_on is not null and s.trial_ends_on>=(now() at time zone 'Asia/Colombo')::date)))
$$;
create function public.business_module_enabled(p_org uuid,p_module text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.business_module_entitlements e join public.business_module_catalog m on m.key=e.module_key
 where e.organization_id=p_org and e.module_key=p_module and e.enabled
 and (m.parent_key is null or exists(select 1 from public.business_module_entitlements pe
 where pe.organization_id=p_org and pe.module_key=m.parent_key and pe.enabled)))
$$;
-- Expose only the signed-in user's safe status. Admin notes and other tenants stay private.
create function public.current_business_access() returns jsonb
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
 'enabledModules',modules,'subscription',jsonb_build_object('plan',s.plan,'status',s.status,
 'starts_on',s.starts_on,'expires_on',s.expires_on,'trial_ends_on',s.trial_ends_on));
end $$;

create function public.business_module_user_allowed(p_module text) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select p.is_active and (p.role='super_admin' or
 case p_module
 when 'dashboard' then 'dashboard'=any(p.permissions)
 when 'purchases' then 'purchases'=any(p.permissions)
 when 'sales' then 'sales'=any(p.permissions)
 when 'inventory' then 'stock'=any(p.permissions)
 when 'stock_transfers' then 'stock'=any(p.permissions)
 when 'stock_adjustments' then 'stock_adjustment'=any(p.permissions)
 when 'labor' then 'labor'=any(p.permissions)
 when 'cash' then 'cash'=any(p.permissions)
 when 'bank' then p.role='admin' and 'cash'=any(p.permissions)
 when 'expenses' then 'cash'=any(p.permissions)
 when 'payment_reports' then 'payment_reports'=any(p.permissions)
 when 'cheques' then 'payment_reports'=any(p.permissions)
 when 'customer_receivables' then 'sales'=any(p.permissions)
 when 'supplier_payables' then 'purchases'=any(p.permissions) or 'payment_reports'=any(p.permissions)
 when 'centers' then 'centers'=any(p.permissions)
 when 'masters' then 'masters'=any(p.permissions)
 when 'users' then p.role='admin' and 'users'=any(p.permissions)
 when 'audit' then 'audit'=any(p.permissions)
 else false end) from public.profiles p where p.id=auth.uid()),false)
$$;
revoke all on function public.business_module_user_allowed(text) from public,anon,authenticated;

create function public.assert_business_operation(p_module text default null) returns void
language plpgsql stable security definer set search_path=public as $$
declare p public.profiles;
begin
 p:=public.current_profile();
 if not coalesce(p.is_active,false) or not public.business_operational(p.organization_id) then
 raise exception 'Business access restricted: account suspended or subscription unavailable' using errcode='42501'; end if;
 if p_module is not null and (not public.business_module_enabled(p.organization_id,p_module) or not public.business_module_user_allowed(p_module)) then
 raise exception 'Module access restricted: contact InfoAxon Support' using errcode='42501'; end if;
end $$;
revoke all on function public.business_operational(uuid),public.business_module_enabled(uuid,text),
 public.current_business_access(),public.assert_business_operation(text) from public,anon;
-- Boolean helpers cannot reveal another organization's status.
revoke all on function public.business_operational(uuid),public.business_module_enabled(uuid,text) from authenticated;
grant execute on function public.current_business_access(),public.assert_business_operation(text) to authenticated;
grant execute on function public.business_operational(uuid),public.business_module_enabled(uuid,text) to service_role;
commit;
