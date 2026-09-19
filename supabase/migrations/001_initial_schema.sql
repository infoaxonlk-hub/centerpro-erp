create extension if not exists pgcrypto;

create type public.app_role as enum ('super_admin', 'admin', 'center_user');
create type public.purchase_status as enum ('draft', 'confirmed', 'cancelled');
create type public.payment_method as enum ('cash', 'bank_transfer', 'card', 'cheque');
create type public.stock_movement_type as enum ('purchase_in', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'reversal');
create type public.cash_movement_type as enum ('allocation', 'purchase', 'refund', 'adjustment');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency_code text not null default 'LKR',
  timezone text not null default 'Asia/Colombo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  address text,
  phone text,
  allow_multiple_locations boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id),
  code text not null,
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (center_id, code)
);
create unique index one_default_location_per_center on public.locations(center_id) where is_default;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  full_name text not null,
  phone text,
  role public.app_role not null default 'center_user',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_center_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  center_id uuid not null references public.centers(id) on delete cascade,
  primary key (user_id, center_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  category text,
  unit_of_measure text not null default 'KG',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.product_qualities (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  name text not null,
  description text,
  default_price numeric(18,2) not null check (default_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

create table public.center_prices (
  center_id uuid not null references public.centers(id),
  quality_id uuid not null references public.product_qualities(id),
  price numeric(18,2) not null check (price >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (center_id, quality_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  nic_or_registration text,
  phone text,
  address text,
  bank_details text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  supplier_id uuid not null references public.suppliers(id),
  po_number text not null,
  status public.purchase_status not null default 'draft',
  payment_method public.payment_method not null,
  payment_reference text,
  notes text,
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, po_number)
);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quality_id uuid not null references public.product_qualities(id),
  location_id uuid references public.locations(id),
  quantity numeric(18,3) not null check (quantity > 0),
  system_price numeric(18,2) not null check (system_price >= 0),
  actual_price numeric(18,2) not null check (actual_price >= 0),
  line_total numeric(18,2) generated always as (round(quantity * actual_price, 2)) stored,
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  location_id uuid not null references public.locations(id),
  product_id uuid not null references public.products(id),
  quality_id uuid not null references public.product_qualities(id),
  movement_type public.stock_movement_type not null,
  quantity numeric(18,3) not null check (quantity <> 0),
  unit_cost numeric(18,2) not null check (unit_cost >= 0),
  reference_type text not null,
  reference_id uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  movement_type public.cash_movement_type not null,
  amount numeric(18,2) not null check (amount > 0),
  reference_type text not null,
  reference_id uuid,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  purchase_order_id uuid not null references public.purchase_orders(id),
  method public.payment_method not null,
  amount numeric(18,2) not null check (amount > 0),
  reference text,
  cheque_bank text,
  cheque_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  type text not null,
  title text not null,
  message text not null,
  center_id uuid references public.centers(id),
  reference_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_profile()
returns public.profiles
language sql stable security definer set search_path = public
as $$ select * from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select role in ('super_admin','admin') and is_active from public.profiles where id=auth.uid()), false) $$;

create or replace function public.can_access_center(target_center uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.user_center_access uca
    join public.profiles p on p.id=uca.user_id
    where uca.user_id=auth.uid() and uca.center_id=target_center and p.is_active
  )
$$;

create or replace function public.center_cash_balance(target_center uuid)
returns numeric language sql stable security definer set search_path = public
as $$
  select coalesce(sum(case when movement_type in ('allocation','refund') then amount else -amount end),0)
  from public.cash_ledger where center_id=target_center
$$;

create or replace function public.confirm_purchase(target_po uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  po public.purchase_orders%rowtype;
  line public.purchase_order_lines%rowtype;
  center_row public.centers%rowtype;
  default_location uuid;
  computed_total numeric(18,2);
begin
  select * into po from public.purchase_orders where id=target_po for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not public.can_access_center(po.center_id) then raise exception 'Access denied'; end if;
  if po.status <> 'draft' then raise exception 'Only draft purchases can be confirmed'; end if;
  select * into center_row from public.centers where id=po.center_id;
  select id into default_location from public.locations where center_id=po.center_id and is_default and is_active;
  if default_location is null then raise exception 'Center requires an active default location'; end if;
  if not exists (select 1 from public.purchase_order_lines where purchase_order_id=po.id) then raise exception 'At least one purchase line is required'; end if;

  for line in select * from public.purchase_order_lines where purchase_order_id=po.id loop
    if center_row.allow_multiple_locations and line.location_id is null then
      raise exception 'Location is required for every purchase line at this center';
    end if;
    if line.location_id is not null and not exists (
      select 1 from public.locations where id=line.location_id and center_id=po.center_id and is_active
    ) then raise exception 'Selected location does not belong to this center'; end if;
    if not exists (select 1 from public.product_qualities where id=line.quality_id and product_id=line.product_id) then
      raise exception 'Selected quality does not belong to the product';
    end if;
  end loop;

  select round(sum(line_total),2) into computed_total from public.purchase_order_lines where purchase_order_id=po.id;
  if po.payment_method='cash' and public.center_cash_balance(po.center_id) < computed_total then
    raise exception 'Insufficient center cash balance';
  end if;

  update public.purchase_order_lines set location_id=default_location
    where purchase_order_id=po.id and location_id is null;
  update public.purchase_orders set status='confirmed', total_amount=computed_total,
    confirmed_at=now(), confirmed_by=auth.uid(), updated_at=now() where id=po.id;

  insert into public.stock_movements
    (organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
  select po.organization_id,po.center_id,l.location_id,l.product_id,l.quality_id,'purchase_in',l.quantity,l.actual_price,'purchase_order',po.id,auth.uid()
    from public.purchase_order_lines l where l.purchase_order_id=po.id;

  insert into public.payments (organization_id,center_id,purchase_order_id,method,amount,reference,created_by)
  values (po.organization_id,po.center_id,po.id,po.payment_method,computed_total,po.payment_reference,auth.uid());

  if po.payment_method='cash' then
    insert into public.cash_ledger (organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by)
    values (po.organization_id,po.center_id,'purchase',computed_total,'purchase_order',po.id,po.po_number,auth.uid());
  end if;

  insert into public.notifications (organization_id,type,title,message,center_id,reference_id)
  select po.organization_id,'price_override','Purchase price changed','One or more prices differ from the configured price on '||po.po_number,po.center_id,po.id
  where exists (select 1 from public.purchase_order_lines where purchase_order_id=po.id and actual_price<>system_price);

  insert into public.audit_logs (organization_id,actor_id,action,entity_type,entity_id,after_data)
  values (po.organization_id,auth.uid(),'purchase_confirmed','purchase_order',po.id::text,jsonb_build_object('po_number',po.po_number,'total',computed_total));
end $$;

alter table public.organizations enable row level security;
alter table public.centers enable row level security;
alter table public.locations enable row level security;
alter table public.profiles enable row level security;
alter table public.user_center_access enable row level security;
alter table public.products enable row level security;
alter table public.product_qualities enable row level security;
alter table public.center_prices enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.stock_movements enable row level security;
alter table public.cash_ledger enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles read own org" on public.profiles for select using (organization_id=(public.current_profile()).organization_id);
create policy "admins manage profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "users read own organization" on public.organizations for select using (id=(public.current_profile()).organization_id);
create policy "users read permitted centers" on public.centers for select using (organization_id=(public.current_profile()).organization_id and public.can_access_center(id));
create policy "admins manage centers" on public.centers for all using (public.is_admin()) with check (public.is_admin());
create policy "users read permitted locations" on public.locations for select using (public.can_access_center(center_id));
create policy "admins manage locations" on public.locations for all using (public.is_admin()) with check (public.is_admin());
create policy "users read center access" on public.user_center_access for select using (user_id=auth.uid() or public.is_admin());
create policy "admins manage center access" on public.user_center_access for all using (public.is_admin()) with check (public.is_admin());
create policy "org reads products" on public.products for select using (organization_id=(public.current_profile()).organization_id);
create policy "admins manage products" on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy "org reads qualities" on public.product_qualities for select using (exists(select 1 from public.products p where p.id=product_id and p.organization_id=(public.current_profile()).organization_id));
create policy "admins manage qualities" on public.product_qualities for all using (public.is_admin()) with check (public.is_admin());
create policy "users read permitted prices" on public.center_prices for select using (public.can_access_center(center_id));
create policy "admins manage prices" on public.center_prices for all using (public.is_admin()) with check (public.is_admin());
create policy "org reads suppliers" on public.suppliers for select using (organization_id=(public.current_profile()).organization_id);
create policy "active users create suppliers" on public.suppliers for insert with check (organization_id=(public.current_profile()).organization_id and (public.current_profile()).is_active);
create policy "admins update suppliers" on public.suppliers for update using (public.is_admin()) with check (public.is_admin());
create policy "users read permitted purchases" on public.purchase_orders for select using (public.can_access_center(center_id));
create policy "users create permitted purchases" on public.purchase_orders for insert with check (public.can_access_center(center_id) and created_by=auth.uid() and organization_id=(public.current_profile()).organization_id);
create policy "users update own drafts" on public.purchase_orders for update using (status='draft' and public.can_access_center(center_id)) with check (status='draft' and public.can_access_center(center_id));
create policy "users read permitted purchase lines" on public.purchase_order_lines for select using (exists(select 1 from public.purchase_orders po where po.id=purchase_order_id and public.can_access_center(po.center_id)));
create policy "users manage draft purchase lines" on public.purchase_order_lines for all using (exists(select 1 from public.purchase_orders po where po.id=purchase_order_id and po.status='draft' and public.can_access_center(po.center_id))) with check (exists(select 1 from public.purchase_orders po where po.id=purchase_order_id and po.status='draft' and public.can_access_center(po.center_id)));
create policy "users read permitted stock" on public.stock_movements for select using (public.can_access_center(center_id));
create policy "users read permitted cash" on public.cash_ledger for select using (public.can_access_center(center_id));
create policy "admins allocate cash" on public.cash_ledger for insert with check (public.is_admin() and movement_type in ('allocation','adjustment'));
create policy "users read permitted payments" on public.payments for select using (public.can_access_center(center_id));
create policy "admins read notifications" on public.notifications for select using (public.is_admin() and organization_id=(public.current_profile()).organization_id);
create policy "admins update notifications" on public.notifications for update using (public.is_admin()) with check (public.is_admin());
create policy "admins read audit" on public.audit_logs for select using (public.is_admin() and organization_id=(public.current_profile()).organization_id);

grant execute on function public.confirm_purchase(uuid) to authenticated;
grant execute on function public.center_cash_balance(uuid) to authenticated;
