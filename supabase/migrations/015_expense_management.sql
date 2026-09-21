-- Center expense funds, categorized expenses, and safe payment posting.
create table if not exists public.expense_categories (
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

create table if not exists public.expense_cash_handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  issued_amount numeric(18,2) not null check (issued_amount > 0),
  received_amount numeric(18,2),
  difference_amount numeric(18,2),
  reference text not null,
  issue_note text,
  response_note text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  issued_by uuid not null references public.profiles(id),
  received_by uuid references public.profiles(id),
  issued_at timestamptz not null default now(),
  responded_at timestamptz
);

create table if not exists public.expense_cash_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  movement_type text not null check (movement_type in ('allocation','expense','adjustment')),
  amount numeric(18,2) not null check (amount > 0),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  category_id uuid not null references public.expense_categories(id),
  expense_date date not null default current_date,
  payee text not null,
  amount numeric(18,2) not null check (amount > 0),
  method public.payment_method not null,
  payment_status text not null check (payment_status in ('paid','unpaid')),
  reference text,
  cheque_number text,
  cheque_date date,
  bank_account_id uuid references public.bank_accounts(id),
  bank_code text,
  branch_code text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists expenses_center_date_idx on public.expenses(center_id, expense_date desc);
create index if not exists expenses_category_date_idx on public.expenses(category_id, expense_date desc);
create index if not exists expense_cash_ledger_center_idx on public.expense_cash_ledger(center_id, created_at desc);

alter table public.expense_categories enable row level security;
alter table public.expense_cash_handovers enable row level security;
alter table public.expense_cash_ledger enable row level security;
alter table public.expenses enable row level security;

create policy "org reads expense categories" on public.expense_categories for select using (organization_id=(public.current_profile()).organization_id);
create policy "admins manage expense categories" on public.expense_categories for all using (public.is_admin()) with check (public.is_admin() and organization_id=(public.current_profile()).organization_id);
create policy "users read expense handovers" on public.expense_cash_handovers for select using (organization_id=(public.current_profile()).organization_id and public.can_access_center(center_id));
create policy "users read expense cash ledger" on public.expense_cash_ledger for select using (organization_id=(public.current_profile()).organization_id and public.can_access_center(center_id));
create policy "users read permitted expenses" on public.expenses for select using (organization_id=(public.current_profile()).organization_id and public.can_access_center(center_id));

create or replace function public.center_expense_cash_balance(target_center uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(case when movement_type in ('allocation','adjustment') then amount else -amount end),0)::numeric(18,2)
  from public.expense_cash_ledger where center_id=target_center;
$$;

create or replace function public.issue_center_expense_cash(target_center uuid, issue_amount numeric, issue_reference text, issue_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid; handover_id uuid; center_label text;
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if issue_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  select organization_id,code||' · '||name into org_id,center_label from public.centers where id=target_center and is_active;
  if org_id is null or org_id<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
  insert into public.expense_cash_handovers(organization_id,center_id,issued_amount,reference,issue_note,issued_by)
  values(org_id,target_center,round(issue_amount,2),coalesce(nullif(trim(issue_reference),''),'expense_cash_issue'),nullif(trim(issue_note),''),auth.uid()) returning id into handover_id;
  insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
  values(org_id,'expense_cash_issued','Expense cash awaiting receipt','Admin issued expense cash of LKR '||to_char(round(issue_amount,2),'FM999G999G999G990D00')||' to '||center_label||'. Please confirm the amount received.',target_center,handover_id,'center');
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(org_id,auth.uid(),'expense_cash_issued','expense_cash_handover',handover_id::text,jsonb_build_object('center_id',target_center,'issued_amount',round(issue_amount,2),'reference',issue_reference));
  return handover_id;
end $$;

create or replace function public.respond_expense_cash_handover(target_handover uuid,response_action text,actual_received numeric default null,response_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare h public.expense_cash_handovers%rowtype; actor public.profiles%rowtype; diff numeric(18,2); ledger_id uuid; title text; message text;
begin
  select * into actor from public.profiles where id=auth.uid() and is_active;
  if actor.id is null or actor.role<>'center_user' then raise exception 'Only an active center user can respond'; end if;
  select * into h from public.expense_cash_handovers where id=target_handover for update;
  if not found or h.organization_id<>actor.organization_id or not public.can_access_center(h.center_id) then raise exception 'Expense cash issue not found'; end if;
  if h.status<>'pending' then raise exception 'This expense cash issue has already been responded to'; end if;
  if response_action not in ('accept','reject') then raise exception 'Invalid response'; end if;
  if response_action='reject' then
    if nullif(trim(response_reason),'') is null then raise exception 'A rejection reason is required'; end if;
    diff:=round(coalesce(actual_received,0)-h.issued_amount,2);
    update public.expense_cash_handovers set status='rejected',received_amount=coalesce(actual_received,0),difference_amount=diff,response_note=trim(response_reason),received_by=auth.uid(),responded_at=now() where id=h.id;
    title:='Center rejected expense cash'; message:='Expense cash issue '||h.reference||' was rejected. Reason: '||trim(response_reason);
  else
    if actual_received is null or actual_received<0 then raise exception 'Enter the actual received amount'; end if;
    diff:=round(actual_received-h.issued_amount,2);
    if diff<>0 and nullif(trim(response_reason),'') is null then raise exception 'A reason is required when the received amount is different'; end if;
    update public.expense_cash_handovers set status='accepted',received_amount=round(actual_received,2),difference_amount=diff,response_note=nullif(trim(response_reason),''),received_by=auth.uid(),responded_at=now() where id=h.id;
    if actual_received>0 then insert into public.expense_cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(h.organization_id,h.center_id,'allocation',round(actual_received,2),'expense_cash_handover',h.id,'Received against '||h.reference,auth.uid()) returning id into ledger_id; end if;
    title:=case when diff=0 then 'Center received expense cash' else 'Expense cash difference reported' end;
    message:=case when diff=0 then 'Expense cash handover '||h.reference||' was received in full: LKR '||to_char(actual_received,'FM999G999G999G990D00') else 'Issued LKR '||to_char(h.issued_amount,'FM999G999G999G990D00')||', received LKR '||to_char(actual_received,'FM999G999G999G990D00')||'. Reason: '||trim(response_reason) end;
  end if;
  insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
  values(h.organization_id,case when response_action='reject' then 'expense_cash_rejected' when coalesce(diff,0)<>0 then 'expense_cash_difference' else 'expense_cash_received' end,title,message,h.center_id,h.id,'admin');
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(h.organization_id,auth.uid(),'expense_cash_'||case when response_action='accept' then 'accepted' else 'rejected' end,'expense_cash_handover',h.id::text,jsonb_build_object('received_amount',actual_received,'difference',diff,'reason',response_reason,'ledger_id',ledger_id));
end $$;

create or replace function public.create_center_expense(target_center uuid,target_category uuid,target_date date,target_payee text,target_amount numeric,target_method public.payment_method,target_reference text default null,target_bank_account uuid default null,target_cheque_number text default null,target_cheque_date date default null,target_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid; expense_id uuid; account public.bank_accounts%rowtype; bank public.payment_banks%rowtype;
begin
  if not public.can_access_center(target_center) then raise exception 'Access denied for this center'; end if;
  if target_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  if nullif(trim(target_payee),'') is null then raise exception 'Payee is required'; end if;
  select organization_id into org_id from public.centers where id=target_center and is_active;
  if org_id is null or org_id<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
  if not exists(select 1 from public.expense_categories where id=target_category and organization_id=org_id and is_active) then raise exception 'Select an active expense category'; end if;
  if target_method='cash' and public.center_expense_cash_balance(target_center)<target_amount then raise exception 'Insufficient expense cash balance'; end if;
  if target_method in ('bank_transfer','card','cheque') then
    select * into account from public.bank_accounts where id=target_bank_account and organization_id=org_id and is_active;
    if not found then raise exception 'Select a valid active bank account'; end if;
    select * into bank from public.payment_banks where id=account.bank_id and organization_id=org_id and is_active;
    if not found then raise exception 'The selected bank is inactive'; end if;
  end if;
  if target_method='cheque' and (nullif(trim(target_cheque_number),'') is null or target_cheque_date is null) then raise exception 'Cheque number and cheque date are required'; end if;
  insert into public.expenses(organization_id,center_id,category_id,expense_date,payee,amount,method,payment_status,reference,cheque_number,cheque_date,bank_account_id,bank_code,branch_code,notes,created_by)
  values(org_id,target_center,target_category,coalesce(target_date,current_date),trim(target_payee),round(target_amount,2),target_method,case when target_method='credit' then 'unpaid' else 'paid' end,nullif(trim(target_reference),''),nullif(trim(target_cheque_number),''),target_cheque_date,case when target_method in ('bank_transfer','card','cheque') then account.id end,case when target_method in ('bank_transfer','card','cheque') then bank.code end,case when target_method in ('bank_transfer','card','cheque') then account.branch_code end,nullif(trim(target_notes),''),auth.uid()) returning id into expense_id;
  if target_method='cash' then insert into public.expense_cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(org_id,target_center,'expense',round(target_amount,2),'expense',expense_id,'Cash expense: '||trim(target_payee),auth.uid()); end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org_id,auth.uid(),'expense_created','expense',expense_id::text,jsonb_build_object('center_id',target_center,'category_id',target_category,'amount',target_amount,'method',target_method));
  return expense_id;
end $$;

revoke all on function public.center_expense_cash_balance(uuid) from public;
grant execute on function public.center_expense_cash_balance(uuid) to authenticated;
revoke all on function public.issue_center_expense_cash(uuid,numeric,text,text) from public;
grant execute on function public.issue_center_expense_cash(uuid,numeric,text,text) to authenticated;
revoke all on function public.respond_expense_cash_handover(uuid,text,numeric,text) from public;
grant execute on function public.respond_expense_cash_handover(uuid,text,numeric,text) to authenticated;
revoke all on function public.create_center_expense(uuid,uuid,date,text,numeric,public.payment_method,text,uuid,text,date,text) from public;
grant execute on function public.create_center_expense(uuid,uuid,date,text,numeric,public.payment_method,text,uuid,text,date,text) to authenticated;
grant select on public.expense_categories,public.expense_cash_handovers,public.expense_cash_ledger,public.expenses to authenticated;
