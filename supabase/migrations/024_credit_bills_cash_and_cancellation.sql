begin;

-- Every confirmed sale has a stable invoice number; credit is its opening due.
create table public.sales_invoices (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 center_id uuid not null references public.centers(id),
 sales_order_id uuid not null unique references public.sales_orders(id),
 customer_id uuid references public.customers(id),
 invoice_number text not null unique,
 total_amount numeric(18,2) not null check (total_amount>0),
 outstanding_amount numeric(18,2) not null check (outstanding_amount>=0),
 status text not null check (status in ('paid','partially_paid','unpaid','cancelled')),
 created_at timestamptz not null default now()
);
insert into public.sales_invoices(organization_id,center_id,sales_order_id,customer_id,invoice_number,total_amount,outstanding_amount,status,created_at)
 select organization_id,center_id,id,customer_id,'INV-'||substring(sale_number from 4),total_amount,credit_balance,payment_status,confirmed_at from public.sales_orders;
create function public.create_sales_invoice() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.sales_invoices(organization_id,center_id,sales_order_id,customer_id,invoice_number,total_amount,outstanding_amount,status,created_at)
 values(new.organization_id,new.center_id,new.id,new.customer_id,'INV-'||substring(new.sale_number from 4),new.total_amount,new.credit_balance,new.payment_status,new.confirmed_at);
 return new;
end $$;
create trigger sales_invoice_after_insert after insert on public.sales_orders for each row execute function public.create_sales_invoice();
alter table public.sales_orders add column status text not null default 'confirmed' check(status in ('confirmed','cancelled'));
alter table public.customer_receivables add column is_void boolean not null default false;
alter table public.sales_invoices enable row level security;
create policy invoices_read on public.sales_invoices for select using (public.sales_center_access(center_id));
grant select on public.sales_invoices to authenticated;

create table public.sales_credit_settlements (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.sales_invoices(id),
 amount numeric(18,2) not null check(amount>0), method public.payment_method not null check(method<>'credit'),
 payment_id uuid not null references public.sales_payments(id), created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.purchase_credit_settlements (
 id uuid primary key default gen_random_uuid(), payable_id uuid not null references public.supplier_payables(id),
 amount numeric(18,2) not null check(amount>0), method public.payment_method not null check(method<>'credit'),
 payment_id uuid not null references public.payments(id), created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.sales_credit_settlements enable row level security;
alter table public.purchase_credit_settlements enable row level security;
create policy sales_settlements_read on public.sales_credit_settlements for select using(exists(select 1 from public.sales_invoices i where i.id=invoice_id and public.sales_center_access(i.center_id)));
create policy purchase_settlements_read on public.purchase_credit_settlements for select using(exists(select 1 from public.supplier_payables p where p.id=payable_id and public.can_access_center(p.center_id)));
grant select on public.sales_credit_settlements,public.purchase_credit_settlements to authenticated;

create function public.receive_invoice_payment(p_invoice uuid,p_amount numeric,p_method public.payment_method,p_bank_account uuid default null,p_reference text default null)
returns void language plpgsql security definer set search_path=public as $$
declare i public.sales_invoices%rowtype; a public.bank_accounts%rowtype; b public.payment_banks%rowtype; pid uuid; v_amount numeric(18,2);
begin
 select * into i from public.sales_invoices where id=p_invoice for update;
 if not found or not public.sales_center_access(i.center_id) or i.status='cancelled' then raise exception 'Invoice not available'; end if;
 if p_method is null or p_method not in ('cash','bank_transfer','card') then raise exception 'Choose cash, bank transfer or card'; end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>i.outstanding_amount then raise exception 'Payment must be positive and cannot exceed the due balance'; end if;
 v_amount:=round(p_amount,2);
 if p_method in ('bank_transfer','card') then
  select * into a from public.bank_accounts where id=p_bank_account and organization_id=i.organization_id and is_active;
  if not found then raise exception 'Select an active bank account'; end if;
  select * into b from public.payment_banks where id=a.bank_id and organization_id=i.organization_id and is_active;
  if not found then raise exception 'Selected bank inactive'; end if;
 end if;
 insert into public.sales_payments(sales_order_id,method,amount,bank_account_id,bank_name,account_number,branch_name,branch_code,reference)
 values(i.sales_order_id,p_method,v_amount,a.id,b.name,a.account_number,a.branch_name,a.branch_code,nullif(trim(p_reference),'')) returning id into pid;
 insert into public.sales_credit_settlements(invoice_id,amount,method,payment_id,created_by) values(i.id,v_amount,p_method,pid,auth.uid());
 update public.sales_invoices set outstanding_amount=outstanding_amount-v_amount,status=case when outstanding_amount=v_amount then 'paid' else 'partially_paid' end where id=i.id;
 update public.customer_receivables set outstanding_amount=outstanding_amount-v_amount where sales_order_id=i.sales_order_id and not is_void;
 update public.sales_orders set paid_amount=paid_amount+v_amount,credit_balance=credit_balance-v_amount,payment_status=case when credit_balance=v_amount then 'paid' else 'partially_paid' end where id=i.sales_order_id;
 if p_method='cash' then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(i.organization_id,i.center_id,'sale_receipt',v_amount,'sales_invoice',i.id,i.invoice_number||' credit collection',auth.uid()); end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(i.organization_id,auth.uid(),'invoice_payment_received','sales_invoice',i.id::text,jsonb_build_object('amount',v_amount,'method',p_method));
end $$;

create function public.pay_supplier_credit(p_payable uuid,p_amount numeric,p_method public.payment_method,p_bank_account uuid default null,p_reference text default null)
returns void language plpgsql security definer set search_path=public as $$
declare p public.supplier_payables%rowtype; a public.bank_accounts%rowtype; b public.payment_banks%rowtype; pid uuid; v_amount numeric(18,2);
begin
 select * into p from public.supplier_payables where id=p_payable for update;
 if not found or not public.has_permission('purchases') or not public.can_access_center(p.center_id) or p.status='void' then raise exception 'Payable not available'; end if;
 perform 1 from public.centers where id=p.center_id for update;
 if p_method is null or p_method not in ('cash','bank_transfer','card') then raise exception 'Choose cash, bank transfer or card'; end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>p.outstanding_amount then raise exception 'Payment must be positive and cannot exceed the due balance'; end if;
 v_amount:=round(p_amount,2);
 if p_method='cash' and public.center_cash_balance(p.center_id)<v_amount then raise exception 'Insufficient center cash'; end if;
 if p_method in ('bank_transfer','card') then
  select * into a from public.bank_accounts where id=p_bank_account and organization_id=p.organization_id and is_active;
  if not found then raise exception 'Select an active bank account'; end if;
  select * into b from public.payment_banks where id=a.bank_id and organization_id=p.organization_id and is_active;
  if not found then raise exception 'Selected bank inactive'; end if;
 end if;
 insert into public.payments(organization_id,center_id,purchase_order_id,method,amount,reference,created_by,bank_id,bank_account_id,bank_code,branch_code)
 values(p.organization_id,p.center_id,p.purchase_order_id,p_method,v_amount,nullif(trim(p_reference),''),auth.uid(),b.id,a.id,b.code,a.branch_code) returning id into pid;
 insert into public.purchase_credit_settlements(payable_id,amount,method,payment_id,created_by) values(p.id,v_amount,p_method,pid,auth.uid());
 update public.supplier_payables set outstanding_amount=outstanding_amount-v_amount,status=case when outstanding_amount=v_amount then 'paid' else 'partially_paid' end,updated_at=now() where id=p.id;
 update public.purchase_orders set paid_amount=paid_amount+v_amount,credit_balance=credit_balance-v_amount,payment_status=case when credit_balance=v_amount then 'paid' else 'partially_paid' end,updated_at=now() where id=p.purchase_order_id;
 if p_method='cash' then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(p.organization_id,p.center_id,'purchase',v_amount,'supplier_payable',p.id,'Credit purchase payment',auth.uid()); end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(p.organization_id,auth.uid(),'supplier_credit_paid','supplier_payable',p.id::text,jsonb_build_object('amount',v_amount,'method',p_method));
end $$;

create table public.bill_cancel_requests (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), center_id uuid not null references public.centers(id),
 bill_type text not null check(bill_type in ('sale','purchase')), bill_id uuid not null, reason text not null check(length(trim(reason))>0),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_by uuid not null references public.profiles(id), requested_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_note text
);
create unique index bill_cancel_one_pending on public.bill_cancel_requests(bill_type,bill_id) where status='pending';
alter table public.bill_cancel_requests enable row level security;
create policy cancellation_read on public.bill_cancel_requests for select using(organization_id=(public.current_profile()).organization_id and (public.is_admin() or public.can_access_center(center_id)));
grant select on public.bill_cancel_requests to authenticated;

create function public.request_bill_cancellation(p_type text,p_bill uuid,p_reason text) returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid; cid uuid; number text; rid uuid;
begin
 if nullif(trim(p_reason),'') is null then raise exception 'Enter a cancellation reason'; end if;
 if p_type='sale' then
  select organization_id,center_id,sale_number into org,cid,number from public.sales_orders where id=p_bill and status='confirmed';
  if not public.sales_center_access(cid) then raise exception 'Sale unavailable'; end if;
 elsif p_type='purchase' then
  select organization_id,center_id,po_number into org,cid,number from public.purchase_orders where id=p_bill and status='confirmed';
  if not public.has_permission('purchases') or not public.can_access_center(cid) then raise exception 'Purchase unavailable'; end if;
 else raise exception 'Invalid bill type'; end if;
 if org is null or org<>(public.current_profile()).organization_id then raise exception 'Bill not found'; end if;
 insert into public.bill_cancel_requests(organization_id,center_id,bill_type,bill_id,reason,requested_by) values(org,cid,p_type,p_bill,trim(p_reason),auth.uid()) returning id into rid;
 insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience) values(org,'bill_cancel_request','Bill cancellation request',number||': '||trim(p_reason),cid,rid,'admin');
 return rid;
end $$;

-- Approval is intentionally conservative: a settled credit or stock already sold blocks reversal.
create function public.review_bill_cancellation(p_request uuid,p_approve boolean,p_note text default null) returns void language plpgsql security definer set search_path=public as $$
declare r public.bill_cancel_requests%rowtype; so public.sales_orders%rowtype; po public.purchase_orders%rowtype; ln record; cash_amount numeric; available numeric;
begin
 if not public.is_admin() then raise exception 'Administrator access required'; end if;
 select * into r from public.bill_cancel_requests where id=p_request for update;
 if not found or r.status<>'pending' or r.organization_id<>(public.current_profile()).organization_id then raise exception 'Pending request not found'; end if;
 if p_approve then
  if r.bill_type='sale' then
   select * into so from public.sales_orders where id=r.bill_id and status='confirmed' for update;
   if not found then raise exception 'Sale is no longer active'; end if;
   if exists(select 1 from public.sales_credit_settlements x join public.sales_invoices i on i.id=x.invoice_id where i.sales_order_id=so.id) then raise exception 'Credit payments exist. Reconcile them before cancellation'; end if;
   if exists(select 1 from public.sales_payments where sales_order_id=so.id and method<>'cash') then raise exception 'Non-cash payment needs manual refund review before cancellation'; end if;
   select coalesce(sum(amount),0) into cash_amount from public.sales_payments where sales_order_id=so.id and method='cash';
   if cash_amount>public.center_cash_balance(so.center_id) then raise exception 'Insufficient center cash to reverse sale'; end if;
   insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
    select so.organization_id,so.center_id,location_id,product_id,quality_id,'adjustment_in',quantity,unit_cost,'sale_cancellation',r.id,auth.uid() from public.sales_order_lines where sales_order_id=so.id;
   if cash_amount>0 then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(so.organization_id,so.center_id,'purchase',cash_amount,'sale_cancellation',r.id,'Cash reversal for '||so.sale_number,auth.uid()); end if;
   update public.sales_orders set status='cancelled' where id=so.id;
   update public.sales_invoices set status='cancelled',outstanding_amount=0 where sales_order_id=so.id;
   update public.customer_receivables set is_void=true,outstanding_amount=0 where sales_order_id=so.id;
  else
   select * into po from public.purchase_orders where id=r.bill_id and status='confirmed' for update;
   if not found then raise exception 'Purchase is no longer active'; end if;
   if exists(select 1 from public.purchase_credit_settlements x join public.supplier_payables p on p.id=x.payable_id where p.purchase_order_id=po.id) then raise exception 'Credit payments exist. Reconcile them before cancellation'; end if;
   if exists(select 1 from public.payments where purchase_order_id=po.id and method<>'cash') then raise exception 'Non-cash payment needs manual refund review before cancellation'; end if;
   for ln in select location_id,product_id,quality_id,sum(quantity) quantity from public.purchase_order_lines where purchase_order_id=po.id group by location_id,product_id,quality_id loop
    if exists(select 1 from public.stock_movements where center_id=po.center_id and location_id=ln.location_id and product_id=ln.product_id and quality_id=ln.quality_id and created_at>po.confirmed_at and movement_type in ('sale_out','transfer_out','adjustment_out','reversal')) then raise exception 'Stock has moved since this purchase; cancellation needs manual reconciliation'; end if;
    select coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity else -quantity end),0) into available from public.stock_movements where center_id=po.center_id and location_id=ln.location_id and product_id=ln.product_id and quality_id=ln.quality_id;
    if available<ln.quantity then raise exception 'Stock has already been used; cannot cancel purchase'; end if;
   end loop;
   insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
    select po.organization_id,po.center_id,location_id,product_id,quality_id,'reversal',quantity,actual_price,'purchase_cancellation',r.id,auth.uid() from public.purchase_order_lines where purchase_order_id=po.id;
   select coalesce(sum(amount),0) into cash_amount from public.payments where purchase_order_id=po.id and method='cash';
   if cash_amount>0 then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(po.organization_id,po.center_id,'refund',cash_amount,'purchase_cancellation',r.id,'Cash reversal for '||po.po_number,auth.uid()); end if;
   update public.purchase_orders set status='cancelled',updated_at=now() where id=po.id;
   update public.supplier_payables set status='void',outstanding_amount=0,updated_at=now() where purchase_order_id=po.id;
  end if;
 end if;
 update public.bill_cancel_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(p_note),'') where id=r.id;
 insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience) values(r.organization_id,'bill_cancel_review','Cancellation '||case when p_approve then 'approved' else 'rejected' end,upper(r.bill_type)||' cancellation request has been reviewed.',r.center_id,r.id,'center');
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(r.organization_id,auth.uid(),'bill_cancellation_'||case when p_approve then 'approved' else 'rejected' end,'bill_cancel_request',r.id::text,jsonb_build_object('type',r.bill_type,'bill_id',r.bill_id,'note',p_note));
end $$;

-- A center user can report an external cash top-up; it remains pending until an admin verifies it.
create table public.center_cash_topups (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),center_id uuid not null references public.centers(id),
 amount numeric(18,2) not null check(amount>0),reference text not null,notes text,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),reviewed_by uuid references public.profiles(id),reviewed_at timestamptz
);
alter table public.center_cash_topups enable row level security;
create policy topups_read on public.center_cash_topups for select using(organization_id=(public.current_profile()).organization_id and (public.is_admin() or public.can_access_center(center_id)));
grant select on public.center_cash_topups to authenticated;
create function public.request_center_cash_topup(p_center uuid,p_amount numeric,p_reference text,p_notes text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid; rid uuid;
begin
 if (public.current_profile()).role<>'center_user' or not public.has_permission('cash') or not public.can_access_center(p_center) then raise exception 'Center user cash access required'; end if;
 select organization_id into org from public.centers where id=p_center and is_active for update;
 if org is null or org<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or nullif(trim(p_reference),'') is null then raise exception 'Amount and reference required'; end if;
 insert into public.center_cash_topups(organization_id,center_id,amount,reference,notes,status,created_by) values(org,p_center,p_amount,trim(p_reference),nullif(trim(p_notes),''),'approved',auth.uid()) returning id into rid;
 insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(org,p_center,'allocation',p_amount,'center_cash_topup',rid,trim(p_reference),auth.uid());
 insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience) values(org,'center_cash_topup','Center cash added','LKR '||p_amount||' · '||trim(p_reference),p_center,rid,'admin');
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'center_cash_added','center_cash_topup',rid::text,jsonb_build_object('amount',p_amount,'reference',p_reference));
 return rid;
end $$;
create function public.review_center_cash_topup(p_topup uuid,p_approve boolean) returns void language plpgsql security definer set search_path=public as $$
declare t public.center_cash_topups%rowtype;
begin
 if not public.is_admin() then raise exception 'Administrator access required'; end if;
 select * into t from public.center_cash_topups where id=p_topup for update;
 if not found or t.status<>'pending' or t.organization_id<>(public.current_profile()).organization_id then raise exception 'Pending top-up not found'; end if;
 update public.center_cash_topups set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now() where id=t.id;
 if p_approve then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(t.organization_id,t.center_id,'allocation',t.amount,'center_cash_topup',t.id,t.reference,auth.uid()); end if;
 insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience) values(t.organization_id,'center_cash_topup_review','Cash top-up '||case when p_approve then 'approved' else 'rejected' end,t.reference,t.center_id,t.id,'center');
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(t.organization_id,auth.uid(),'center_cash_topup_'||case when p_approve then 'approved' else 'rejected' end,'center_cash_topup',t.id::text,jsonb_build_object('amount',t.amount,'reference',t.reference));
end $$;

revoke all on function public.receive_invoice_payment(uuid,numeric,public.payment_method,uuid,text),public.pay_supplier_credit(uuid,numeric,public.payment_method,uuid,text),public.request_bill_cancellation(text,uuid,text),public.review_bill_cancellation(uuid,boolean,text),public.request_center_cash_topup(uuid,numeric,text,text),public.review_center_cash_topup(uuid,boolean) from public;
grant execute on function public.receive_invoice_payment(uuid,numeric,public.payment_method,uuid,text),public.pay_supplier_credit(uuid,numeric,public.payment_method,uuid,text),public.request_bill_cancellation(text,uuid,text),public.review_bill_cancellation(uuid,boolean,text),public.request_center_cash_topup(uuid,numeric,text,text),public.review_center_cash_topup(uuid,boolean) to authenticated;
commit;
