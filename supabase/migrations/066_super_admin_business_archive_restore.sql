begin;

-- Archive is a reversible access-control state, not a data deletion.
alter table public.organizations
  add column archived_at timestamptz,
  add column archived_by uuid,
  add column archive_reason text,
  add column pre_archive_status text;

alter table public.organizations
  add constraint organizations_archive_metadata_consistency check (
    (
      business_status = 'archived'
      and archived_at is not null
      and archived_by is not null
      and archive_reason is not null
      and char_length(btrim(archive_reason)) between 10 and 500
      and pre_archive_status in ('active', 'suspended')
    )
    or
    (
      business_status <> 'archived'
      and archived_at is null
      and archived_by is null
      and archive_reason is null
      and pre_archive_status is null
    )
  );

create index organizations_archived_at
  on public.organizations(archived_at desc)
  where business_status = 'archived';

-- This audit is intentionally independent of organizations/profiles/Auth foreign keys.
-- It remains readable after a future, separately approved tenant purge.
create table public.platform_business_lifecycle_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  business_id uuid not null,
  business_name text not null,
  action text not null check (action in ('archived', 'restored')),
  actor_id uuid not null,
  actor_name text not null,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  before_status text not null,
  after_status text not null,
  created_at timestamptz not null default clock_timestamp()
);

create index platform_business_lifecycle_audit_business_date
  on public.platform_business_lifecycle_audit(business_id, created_at desc);

alter table public.platform_business_lifecycle_audit enable row level security;
revoke all on public.platform_business_lifecycle_audit from public, anon, authenticated, service_role;
grant select on public.platform_business_lifecycle_audit to service_role;

create function public.reject_platform_lifecycle_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Platform business lifecycle audit is append-only'
    using errcode = '42501';
end;
$$;

create trigger platform_business_lifecycle_audit_immutable
before update or delete on public.platform_business_lifecycle_audit
for each row execute function public.reject_platform_lifecycle_audit_mutation();

revoke all on function public.reject_platform_lifecycle_audit_mutation() from public, anon, authenticated;

-- Status changes between active/suspended remain part of normal configuration.
-- Transitions into/out of archived are only allowed inside the dedicated lifecycle RPCs.
create function public.guard_business_lifecycle_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare lifecycle_action text;
begin
  if new.business_status is not distinct from old.business_status then
    return new;
  end if;

  if old.business_status in ('active', 'suspended')
     and new.business_status in ('active', 'suspended') then
    return new;
  end if;

  lifecycle_action := current_setting('centerpro.business_lifecycle_action', true);

  if lifecycle_action = 'archive'
     and old.business_status in ('active', 'suspended')
     and new.business_status = 'archived' then
    return new;
  end if;

  if lifecycle_action = 'restore'
     and old.business_status = 'archived'
     and new.business_status = 'suspended' then
    return new;
  end if;

  raise exception 'Archived business status can only change through platform archive/restore'
    using errcode = '42501';
end;
$$;

create trigger business_lifecycle_status_guard
before update of business_status on public.organizations
for each row execute function public.guard_business_lifecycle_status();

revoke all on function public.guard_business_lifecycle_status() from public, anon, authenticated;

-- Keep the generic configuration RPC from editing an archived tenant.
-- CREATE OR REPLACE preserves the existing service_role-only execute grants.
create or replace function public.platform_save_business(
  p_actor uuid,
  p_org uuid,
  p_details jsonb,
  p_subscription jsonb,
  p_modules text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  before_org jsonb;
  before_sub jsonb;
  after_sub jsonb;
  before_modules jsonb;
  selected text[];
begin
  perform public.platform_assert_actor(p_actor);

  select to_jsonb(o) into before_org
  from public.organizations o
  where id = p_org
  for update;

  if before_org is null then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  if before_org->>'business_status' = 'archived' then
    raise exception 'Archived business must be restored before configuration changes'
      using errcode = '55000';
  end if;

  selected := array(
    select distinct unnest(array_append(coalesce(p_modules, '{}'::text[]), 'dashboard'))
  );

  if exists (
    select 1 from unnest(selected) k
    where not exists(select 1 from public.business_module_catalog where key = k)
  ) then
    raise exception 'Invalid module selection' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.business_module_catalog
    where key = any(selected)
      and parent_key is not null
      and not (parent_key = any(selected))
  ) then
    raise exception 'Required parent module must be enabled' using errcode = '22023';
  end if;

  if length(trim(p_details->>'name')) not between 2 and 120
     or p_details->>'status' not in ('active', 'suspended') then
    raise exception 'Invalid business details' using errcode = '22023';
  end if;

  if p_subscription->>'status' = 'trialing'
     and nullif(p_subscription->>'trial_ends_on', '') is null then
    raise exception 'Trial end date required' using errcode = '22023';
  end if;

  select to_jsonb(s)-'updated_at' into before_sub
  from public.business_subscriptions s
  where organization_id = p_org;

  select jsonb_agg(module_key order by module_key) into before_modules
  from public.business_module_entitlements
  where organization_id = p_org and enabled;

  update public.organizations
  set name = trim(p_details->>'name'),
      business_status = p_details->>'status',
      receipt_address = nullif(trim(p_details->>'address'), ''),
      receipt_phone = nullif(trim(p_details->>'phone'), ''),
      receipt_email = nullif(trim(p_details->>'email'), ''),
      updated_at = now()
  where id = p_org;

  update public.business_subscriptions
  set plan = p_subscription->>'plan',
      status = p_subscription->>'status',
      starts_on = (p_subscription->>'starts_on')::date,
      expires_on = nullif(p_subscription->>'expires_on', '')::date,
      trial_ends_on = nullif(p_subscription->>'trial_ends_on', '')::date,
      admin_notes = coalesce(p_subscription->>'admin_notes', ''),
      updated_at = now()
  where organization_id = p_org;

  update public.business_module_entitlements
  set enabled = (module_key = any(selected)), updated_at = now()
  where organization_id = p_org;

  select to_jsonb(s)-'updated_at' into after_sub
  from public.business_subscriptions s
  where organization_id = p_org;

  if before_sub is distinct from after_sub then
    insert into public.business_subscription_history(
      organization_id, actor_id, before_data, after_data
    ) values (p_org, p_actor, before_sub, after_sub);
  end if;

  insert into public.audit_logs(
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_org, p_actor, 'business_configuration_updated', 'organization', p_org::text,
    jsonb_build_object(
      'name', before_org->>'name',
      'status', before_org->>'business_status',
      'modules', before_modules,
      'subscription', before_sub-'admin_notes'
    ),
    jsonb_build_object(
      'name', trim(p_details->>'name'),
      'status', p_details->>'status',
      'modules', selected,
      'subscription', after_sub-'admin_notes'
    )
  );

  return p_org;
end;
$$;

create function public.platform_archive_business(
  p_actor uuid,
  p_org uuid,
  p_confirmation_name text,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.organizations;
  actor_org uuid;
  actor_name text;
begin
  perform public.platform_assert_actor(p_actor);

  if p_request_id is null then
    raise exception 'Request ID is required' using errcode = '22023';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then
    raise exception 'Provide an archive reason between 10 and 500 characters'
      using errcode = '22023';
  end if;

  select * into target
  from public.organizations
  where id = p_org
  for update;

  if not found then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  if p_confirmation_name is distinct from target.name then
    raise exception 'Business name confirmation does not match'
      using errcode = '22023';
  end if;

  if target.business_status not in ('active', 'suspended') then
    raise exception 'Only active or suspended businesses can be archived'
      using errcode = '55000';
  end if;

  select organization_id, full_name
    into actor_org, actor_name
  from public.profiles
  where id = p_actor;

  if actor_org = p_org
     or exists (
       select 1 from public.profiles
       where organization_id = p_org and role = 'super_admin'
     ) then
    raise exception 'The platform operator business cannot be archived'
      using errcode = '42501';
  end if;

  perform set_config('centerpro.business_lifecycle_action', 'archive', true);

  update public.organizations
  set business_status = 'archived',
      archived_at = clock_timestamp(),
      archived_by = p_actor,
      archive_reason = btrim(p_reason),
      pre_archive_status = target.business_status,
      updated_at = clock_timestamp()
  where id = p_org;

  perform set_config('centerpro.business_lifecycle_action', '', true);

  insert into public.platform_business_lifecycle_audit(
    request_id, business_id, business_name, action, actor_id, actor_name,
    reason, before_status, after_status
  ) values (
    p_request_id, p_org, target.name, 'archived', p_actor,
    coalesce(nullif(btrim(actor_name), ''), 'Platform administrator'),
    btrim(p_reason), target.business_status, 'archived'
  );

  return p_org;
end;
$$;

create function public.platform_restore_business(
  p_actor uuid,
  p_org uuid,
  p_confirmation_name text,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.organizations;
  actor_org uuid;
  actor_name text;
begin
  perform public.platform_assert_actor(p_actor);

  if p_request_id is null then
    raise exception 'Request ID is required' using errcode = '22023';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then
    raise exception 'Provide a restore reason between 10 and 500 characters'
      using errcode = '22023';
  end if;

  select * into target
  from public.organizations
  where id = p_org
  for update;

  if not found then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  if p_confirmation_name is distinct from target.name then
    raise exception 'Business name confirmation does not match'
      using errcode = '22023';
  end if;

  if target.business_status <> 'archived' then
    raise exception 'Only archived businesses can be restored'
      using errcode = '55000';
  end if;

  select organization_id, full_name
    into actor_org, actor_name
  from public.profiles
  where id = p_actor;

  if actor_org = p_org
     or exists (
       select 1 from public.profiles
       where organization_id = p_org and role = 'super_admin'
     ) then
    raise exception 'The platform operator business cannot be restored through this workflow'
      using errcode = '42501';
  end if;

  perform set_config('centerpro.business_lifecycle_action', 'restore', true);

  update public.organizations
  set business_status = 'suspended',
      archived_at = null,
      archived_by = null,
      archive_reason = null,
      pre_archive_status = null,
      updated_at = clock_timestamp()
  where id = p_org;

  perform set_config('centerpro.business_lifecycle_action', '', true);

  insert into public.platform_business_lifecycle_audit(
    request_id, business_id, business_name, action, actor_id, actor_name,
    reason, before_status, after_status
  ) values (
    p_request_id, p_org, target.name, 'restored', p_actor,
    coalesce(nullif(btrim(actor_name), ''), 'Platform administrator'),
    btrim(p_reason), 'archived', 'suspended'
  );

  return p_org;
end;
$$;

-- A tenant's existing session now reports an explicit archive reason.
create or replace function public.current_business_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.profiles;
  o public.organizations;
  s public.business_subscriptions;
  modules jsonb;
begin
  p := public.current_profile();

  if not coalesce(p.is_active, false) then
    raise exception 'Account access denied' using errcode = '42501';
  end if;

  select * into o from public.organizations where id = p.organization_id;
  select * into s from public.business_subscriptions where organization_id = p.organization_id;

  select coalesce(jsonb_agg(module_key order by module_key), '[]'::jsonb)
    into modules
  from public.business_module_entitlements
  where organization_id = p.organization_id and enabled;

  return jsonb_build_object(
    'organizationId', o.id,
    'businessName', o.name,
    'businessStatus', o.business_status,
    'operational', public.business_operational(o.id),
    'reason',
      case
        when o.business_status = 'archived' then 'archived'
        when o.business_status <> 'active' then 'suspended'
        when not public.business_operational(o.id) then 'subscription'
        else null
      end,
    'enabledModules', modules,
    'subscription', jsonb_build_object(
      'plan', s.plan,
      'status', s.status,
      'starts_on', s.starts_on,
      'expires_on', s.expires_on,
      'trial_ends_on', s.trial_ends_on
    )
  );
end;
$$;

revoke all on function public.platform_archive_business(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.platform_restore_business(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.platform_archive_business(uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function public.platform_restore_business(uuid, uuid, text, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;
