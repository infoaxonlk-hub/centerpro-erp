-- Per-business configuration for standard supplier fields.
-- Preserves values in existing suppliers even when a field is archived.
create table if not exists public.supplier_standard_fields (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  field_key text not null check (field_key in ('name','nic_or_registration','phone','address','bank_details','notes')),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  is_required boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, field_key),
  constraint supplier_name_must_remain_active check (
    field_key <> 'name' or (is_active = true and is_required = true)
  ),
  constraint supplier_archived_must_be_optional check (is_active = true or is_required = false)
);
alter table public.supplier_standard_fields enable row level security;
revoke all on public.supplier_standard_fields from anon, authenticated;
grant select,insert,update on public.supplier_standard_fields to authenticated;
grant all on public.supplier_standard_fields to service_role;
create policy supplier_standard_read on public.supplier_standard_fields
for select to authenticated using(
  organization_id=(select (public.current_profile()).organization_id)
  and (select (public.current_profile()).is_active)
);
create policy supplier_standard_insert on public.supplier_standard_fields
for insert to authenticated with check(
  organization_id=(select (public.current_profile()).organization_id)
  and (select (public.current_profile()).is_active)
  and (select (public.current_profile()).role) in ('admin','super_admin')
);
create policy supplier_standard_update on public.supplier_standard_fields
for update to authenticated using(
  organization_id=(select (public.current_profile()).organization_id)
  and (select (public.current_profile()).is_active)
  and (select (public.current_profile()).role) in ('admin','super_admin')
) with check(
  organization_id=(select (public.current_profile()).organization_id)
  and (select (public.current_profile()).is_active)
  and (select (public.current_profile()).role) in ('admin','super_admin')
);
