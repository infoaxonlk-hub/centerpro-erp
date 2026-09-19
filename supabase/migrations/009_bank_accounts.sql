create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  bank_id uuid not null references public.payment_banks(id),
  account_number text not null,
  branch_name text not null,
  branch_code text not null,
  account_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(organization_id,bank_id,account_number)
);
alter table public.bank_accounts enable row level security;
create policy "org reads bank accounts" on public.bank_accounts for select using(organization_id=(public.current_profile()).organization_id);
create policy "admins manage bank accounts" on public.bank_accounts for all using(public.is_admin()) with check(public.is_admin() and organization_id=(public.current_profile()).organization_id);
alter table public.payments add column if not exists bank_account_id uuid references public.bank_accounts(id);
grant select on public.bank_accounts to authenticated;
