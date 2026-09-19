alter table public.product_qualities
  add column if not exists is_base boolean not null default false;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, name)
);

alter table public.products add column if not exists category_id uuid references public.product_categories(id);

insert into public.product_categories(organization_id, code, name)
select distinct p.organization_id,
  upper(regexp_replace(trim(p.category), '[^a-zA-Z0-9]+', '_', 'g')),
  trim(p.category)
from public.products p
where nullif(trim(p.category), '') is not null
on conflict do nothing;

update public.products p set category_id = c.id
from public.product_categories c
where c.organization_id = p.organization_id and lower(c.name) = lower(trim(p.category)) and p.category_id is null;

alter table public.product_categories enable row level security;
create policy "org reads product categories" on public.product_categories for select
  using (organization_id=(public.current_profile()).organization_id);
create policy "admins manage product categories" on public.product_categories for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.product_qualities (product_id, name, description, default_price, is_base)
select p.id, 'Standard', 'Base product price', 0, true
from public.products p
where not exists (
  select 1 from public.product_qualities q where q.product_id = p.id
);

create unique index if not exists one_base_quality_per_product
  on public.product_qualities(product_id) where is_base;

create or replace function public.create_product_with_pricing(
  product_code text,
  product_name text,
  product_category_id uuid,
  product_unit text,
  global_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org_id uuid;
  new_product_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if global_price is null or global_price < 0 then raise exception 'Global price must be zero or greater'; end if;

  select organization_id into org_id from public.profiles where id = auth.uid();
  if product_category_id is not null and not exists (
    select 1 from public.product_categories where id=product_category_id and organization_id=org_id and is_active
  ) then raise exception 'Invalid product category'; end if;

  insert into public.products(organization_id, code, name, category, category_id, unit_of_measure)
  select org_id, upper(trim(product_code)), trim(product_name), c.name, c.id, product_unit
  from (select product_category_id id) x
  left join public.product_categories c on c.id=x.id
  returning id into new_product_id;

  insert into public.product_qualities(product_id, name, description, default_price, is_base)
  values(new_product_id, 'Standard', 'Base product price', global_price, true);

  return new_product_id;
end;
$$;

grant execute on function public.create_product_with_pricing(text,text,uuid,text,numeric) to authenticated;
