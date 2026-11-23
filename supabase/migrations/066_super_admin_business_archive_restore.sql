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

-- Archived organization rows are immutable. The dedicated restore RPC may only
-- clear archive metadata and return the status to suspended; it cannot edit
-- the business name, contact details, or any unrelated organization fields.
create function public.guard_archived_business_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $
declare lifecycle_action text;
begin
  if old.business_status <> 'archived' then
    return new;
  end if;

  lifecycle_action := current_setting('centerpro.business_lifecycle_action', true);

  if lifecycle_action = 'restore'
     and new.business_status = 'suspended'
     and (to_jsonb(new) - array[
       'business_status', 'archived_at', 'archived_by',
       'archive_reason', 'pre_archive_status', 'updated_at'
     ]::text[])
       is not distinct from
     (to_jsonb(old) - array[
       'business_status', 'archived_at', 'archived_by',
       'archive_reason', 'pre_archive_status', 'updated_at'
     ]::text[]) then
    return new;
  end if;

  raise exception 'Archived business is read-only; restore it before making changes'
    using errcode = '55000';
end;
$;

create trigger organizations_archived_business_read_only
before update on public.organizations
for each row execute function public.guard_archived_business_mutation();

revoke all on function public.guard_archived_business_mutation() from public, anon, authenticated;


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
