-- Laborers are paid individually using a rate captured when they join a session.
create table public.laborers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 180),
  phone text,
  rate_basis text not null check (rate_basis in ('per_kg','per_sack','per_load','fixed_per_order')),
  rate numeric(18,2) not null check (rate >= 0 and rate < 1000000000000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, full_name)
);

create table public.labor_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  center_id uuid not null references public.centers(id),
  session_date date not null default current_date,
  operation text not null check (operation in ('purchase','sales','both')),
  title text not null check (length(trim(title)) between 2 and 180),
  status text not null default 'open' check (status in ('open','closed')),
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table public.labor_session_workers (
  session_id uuid not null references public.labor_sessions(id) on delete cascade,
  laborer_id uuid not null references public.laborers(id),
  rate_basis text not null check (rate_basis in ('per_kg','per_sack','per_load','fixed_per_order')),
  rate numeric(18,2) not null check (rate >= 0),
  primary key(session_id,laborer_id)
);

create table public.labor_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  session_id uuid not null,
  laborer_id uuid not null,
  expense_id uuid not null unique references public.expenses(id),
  amount numeric(18,2) not null check (amount>0),
  paid_by uuid not null default auth.uid() references auth.users(id),
  paid_at timestamptz not null default now(),
  foreign key(session_id,laborer_id) references public.labor_session_workers(session_id,laborer_id)
);

alter table public.purchase_orders add column labor_session_id uuid references public.labor_sessions(id);
alter table public.purchase_orders add column labor_load_count integer not null default 0 check (labor_load_count >= 0);
alter table public.sales_orders add column labor_session_id uuid references public.labor_sessions(id);
alter table public.sales_orders add column labor_load_count integer not null default 0 check (labor_load_count >= 0);

alter table public.laborers enable row level security;
alter table public.labor_sessions enable row level security;
alter table public.labor_session_workers enable row level security;
alter table public.labor_payments enable row level security;
create policy "organization reads laborers" on public.laborers for select
  using (organization_id=(public.current_profile()).organization_id);
create policy "admins manage laborers" on public.laborers for all
  using (public.is_admin() and organization_id=(public.current_profile()).organization_id)
  with check (public.is_admin() and organization_id=(public.current_profile()).organization_id);
create policy "users read center labor sessions" on public.labor_sessions for select
  using (organization_id=(public.current_profile()).organization_id and public.can_access_center(center_id));
create policy "admins manage labor sessions" on public.labor_sessions for all
  using (public.is_admin() and organization_id=(public.current_profile()).organization_id and exists(select 1 from public.centers c where c.id=labor_sessions.center_id and c.organization_id=labor_sessions.organization_id))
  with check (public.is_admin() and organization_id=(public.current_profile()).organization_id and exists(select 1 from public.centers c where c.id=labor_sessions.center_id and c.organization_id=labor_sessions.organization_id));
create policy "users read labor session workers" on public.labor_session_workers for select
  using (exists(select 1 from public.labor_sessions s where s.id=session_id and public.can_access_center(s.center_id)));
create policy "admins manage labor session workers" on public.labor_session_workers for all
  using (public.is_admin() and exists(select 1 from public.labor_sessions s where s.id=session_id and s.organization_id=(public.current_profile()).organization_id))
  with check (public.is_admin() and exists(select 1 from public.labor_sessions s join public.laborers l on l.id=laborer_id where s.id=session_id and s.organization_id=(public.current_profile()).organization_id and l.organization_id=s.organization_id));
create policy "users read labor payments" on public.labor_payments for select
  using (exists(select 1 from public.labor_sessions s where s.id=session_id and public.can_access_center(s.center_id)));
revoke all on public.labor_payments from anon,authenticated;
grant select on public.labor_payments to authenticated;
grant select,insert,update,delete on public.laborers,public.labor_sessions,public.labor_session_workers to authenticated;

create or replace function public.pay_labor_session_worker(p_request uuid,p_session uuid,p_laborer uuid,p_amount numeric,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_session public.labor_sessions%rowtype; v_worker public.labor_session_workers%rowtype; v_name text; v_category uuid; v_expense uuid; v_qty numeric:=0; v_sacks numeric:=0; v_loads numeric:=0; v_orders integer:=0; v_expected numeric(18,2); v_paid numeric(18,2);
begin
  if p_request is null then raise exception 'Payment request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select expense_id into v_expense from public.labor_payments where request_id=p_request and paid_by=auth.uid() and session_id=p_session and laborer_id=p_laborer and amount=round(p_amount,2);
  if v_expense is not null then return v_expense; end if;
  if exists(select 1 from public.labor_payments where request_id=p_request) then raise exception 'Payment request ID is already used'; end if;
  select * into v_session from public.labor_sessions where id=p_session for update;
  if not found or not public.can_access_center(v_session.center_id) then raise exception 'Labor session access denied'; end if;
  if v_session.status<>'closed' then raise exception 'Close the labor session before recording wage payments'; end if;
  if not public.is_admin() and not (coalesce((public.current_profile()).permissions,'{}'::text[]) @> array['labor']) then raise exception 'Labor permission required'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Enter a positive payment amount with up to two decimals'; end if;
  select * into v_worker from public.labor_session_workers where session_id=p_session and laborer_id=p_laborer for update;
  if not found then raise exception 'Laborer is not assigned to this session'; end if;
  select full_name into v_name from public.laborers where id=p_laborer and organization_id=v_session.organization_id;
  select count(*),coalesce(sum(labor_load_count),0),coalesce(sum(x.qty),0),coalesce(sum(x.sacks),0)
    into v_orders,v_loads,v_qty,v_sacks
  from (
    select po.labor_load_count,coalesce(sum(pol.quantity),0) as qty,coalesce(sum(pol.sack_count),0) as sacks
    from public.purchase_orders po left join public.purchase_order_lines pol on pol.purchase_order_id=po.id
    where po.labor_session_id=p_session group by po.id
    union all
    select so.labor_load_count,coalesce(sum(sol.quantity),0),coalesce(sum(case when lower(sol.unit) similar to '%(sack|bag|goni)%' then sol.quantity else 0 end),0)
    from public.sales_orders so left join public.sales_order_lines sol on sol.sales_order_id=so.id
    where so.labor_session_id=p_session group by so.id
  ) x;
  v_expected:=round(v_worker.rate*case v_worker.rate_basis when 'per_kg' then v_qty when 'per_sack' then v_sacks when 'per_load' then v_loads else v_orders end,2);
  select coalesce(sum(amount),0) into v_paid from public.labor_payments where session_id=p_session and laborer_id=p_laborer;
  if v_paid+p_amount>v_expected then raise exception 'Payment exceeds this laborer’s remaining expected wage of LKR %',round(v_expected-v_paid,2); end if;
  insert into public.expense_categories(organization_id,code,name,description,is_active)
  values(v_session.organization_id,'LABOR-WAGES','Labor wages','Payments for collection and handling labor',true)
  on conflict(organization_id,code) do update set is_active=true returning id into v_category;
  v_expense:=public.create_center_expense(v_session.center_id,v_category,v_session.session_date,v_name,p_amount,'cash',p_reference,null,null,null,'Labor session: '||v_session.title);
  insert into public.labor_payments(request_id,session_id,laborer_id,expense_id,amount) values(p_request,p_session,p_laborer,v_expense,round(p_amount,2));
  return v_expense;
end $$;
revoke all on function public.pay_labor_session_worker(uuid,uuid,uuid,numeric,text) from public;
grant execute on function public.pay_labor_session_worker(uuid,uuid,uuid,numeric,text) to authenticated;

create or replace function public.confirm_queued_purchase_with_labor(
  p_request uuid,target_center uuid,target_supplier uuid,purchase_notes text,purchase_lines jsonb,payment_allocations jsonb,
  p_labor_session uuid default null,p_load_count integer default 0,p_detailed boolean default false,
  purchase_sack_counts jsonb default '[]'::jsonb,use_cash_farmer boolean default false
) returns table(purchase_id uuid,purchase_number text,purchase_total numeric,paid_amount numeric,credit_balance numeric,payment_status text)
language plpgsql security definer set search_path=public as $$
declare v_result record; v_session public.labor_sessions%rowtype;
begin
  if p_load_count<0 then raise exception 'Load count cannot be negative'; end if;
  if p_labor_session is not null then
    if not public.has_permission('labor') then raise exception 'Labor permission required'; end if;
    select * into v_session from public.labor_sessions where id=p_labor_session and center_id=target_center and organization_id=(public.current_profile()).organization_id and status='open' and operation in ('purchase','both');
    if not found then raise exception 'Choose an open purchase labor session for this center'; end if;
  end if;
  if p_detailed then
    select * into v_result from public.confirm_queued_purchase_detailed(p_request,target_center,target_supplier,purchase_notes,purchase_lines,payment_allocations,purchase_sack_counts,use_cash_farmer);
  else
    select * into v_result from public.confirm_queued_purchase(p_request,target_center,target_supplier,purchase_notes,purchase_lines,payment_allocations);
  end if;
  update public.purchase_orders set labor_session_id=p_labor_session,labor_load_count=p_load_count where id=v_result.purchase_id;
  return query select v_result.purchase_id,v_result.purchase_number,v_result.purchase_total,v_result.paid_amount,v_result.credit_balance,v_result.payment_status;
end $$;
revoke all on function public.confirm_queued_purchase_with_labor(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer,boolean,jsonb,boolean) from public;
grant execute on function public.confirm_queued_purchase_with_labor(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer,boolean,jsonb,boolean) to authenticated;

create or replace function public.confirm_center_sale_with_labor(
  p_request uuid,p_center uuid,p_customer uuid,p_notes text,p_lines jsonb,p_payments jsonb,p_labor_session uuid default null,p_load_count integer default 0
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_session public.labor_sessions%rowtype;
begin
  if p_load_count<0 then raise exception 'Load count cannot be negative'; end if;
  if p_labor_session is not null then
    if not public.has_permission('labor') then raise exception 'Labor permission required'; end if;
    select * into v_session from public.labor_sessions where id=p_labor_session and center_id=p_center and organization_id=(public.current_profile()).organization_id and status='open' and operation in ('sales','both');
    if not found then raise exception 'Choose an open sales labor session for this center'; end if;
  end if;
  v_id:=public.confirm_center_sale(p_request,p_center,p_customer,p_notes,p_lines,p_payments);
  update public.sales_orders set labor_session_id=p_labor_session,labor_load_count=p_load_count where id=v_id;
  return v_id;
end $$;
revoke all on function public.confirm_center_sale_with_labor(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer) from public;
grant execute on function public.confirm_center_sale_with_labor(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer) to authenticated;
