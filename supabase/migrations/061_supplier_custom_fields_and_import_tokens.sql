-- Supplier fields and idempotent Excel import schema.
-- Deploy after reviewing the supplier bulk import feature and RLS policies.
begin;
alter table public.suppliers
 add column if not exists custom_values jsonb not null default '{}'::jsonb,
 add column if not exists import_token text;
alter table public.suppliers
 add constraint supplier_custom_values_object check (jsonb_typeof(custom_values) = 'object');
create unique index if not exists supplier_import_token_per_business
 on public.suppliers(organization_id, import_token);
create index if not exists supplier_org_name_search on public.suppliers(organization_id, name);

create table if not exists public.supplier_custom_fields (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 field_key text not null check(field_key ~ '^[a-z][a-z0-9_]{0,49}$'),
 label text not null check(length(btrim(label)) between 1 and 80),
 field_type text not null default 'text' check(field_type in ('text','number','date')),
 is_required boolean not null default false,
 is_active boolean not null default true,
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 unique(organization_id, field_key)
);
create index if not exists supplier_custom_fields_business
 on public.supplier_custom_fields(organization_id, sort_order);
alter table public.supplier_custom_fields enable row level security;
revoke all on public.supplier_custom_fields from anon, authenticated;
grant select, insert, update on public.supplier_custom_fields to authenticated;
grant all on public.supplier_custom_fields to service_role;

create policy supplier_field_read on public.supplier_custom_fields
 for select to authenticated using (
 organization_id=(select (public.current_profile()).organization_id)
 and (select (public.current_profile()).is_active)
);
create policy supplier_field_create on public.supplier_custom_fields
 for insert to authenticated with check (
 organization_id=(select (public.current_profile()).organization_id)
 and (select (public.current_profile()).is_active)
 and (select (public.current_profile()).role) in ('admin','super_admin')
 and public.business_operational(organization_id)
);
create policy supplier_field_edit on public.supplier_custom_fields
 for update to authenticated using (
 organization_id=(select (public.current_profile()).organization_id)
 and (select (public.current_profile()).is_active)
 and (select (public.current_profile()).role) in ('admin','super_admin')
 and public.business_operational(organization_id)
) with check (
 organization_id=(select (public.current_profile()).organization_id)
 and (select (public.current_profile()).is_active)
 and (select (public.current_profile()).role) in ('admin','super_admin')
 and public.business_operational(organization_id)
);
commit;
