-- Production-safe split tender support for purchase confirmation.
-- Credit allocations are liabilities, while only non-credit allocations become payments.

alter table public.purchase_orders
  add column if not exists paid_amount numeric(18,2) not null default 0 check (paid_amount >= 0),
  add column if not exists credit_balance numeric(18,2) not null default 0 check (credit_balance >= 0),
  add column if not exists payment_allocations jsonb not null default '[]'::jsonb;

create table if not exists public.supplier_payables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  supplier_id uuid not null references public.suppliers(id),
  purchase_order_id uuid not null references public.purchase_orders(id),
  original_amount numeric(18,2) not null check (original_amount > 0),
  outstanding_amount numeric(18,2) not null check (outstanding_amount >= 0),
  status text not null default 'open' check (status in ('open','partially_paid','paid','void')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id)
);

alter table public.supplier_payables enable row level security;
drop policy if exists "users read permitted supplier payables" on public.supplier_payables;
create policy "users read permitted supplier payables" on public.supplier_payables for select
  using (public.can_access_center(center_id));
grant select on public.supplier_payables to authenticated;

create or replace function public.create_and_confirm_purchase_split(
  target_center uuid,
  target_supplier uuid,
  purchase_notes text,
  purchase_lines jsonb,
  payment_allocations jsonb
)
returns table(
  purchase_id uuid,
  purchase_number text,
  purchase_total numeric,
  paid_amount numeric,
  credit_balance numeric,
  payment_status text
)
language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare
  v_org_id uuid; v_po_id uuid; v_po_number text; v_item jsonb; v_allocation jsonb;
  v_product_id uuid; v_quality_id uuid; v_location_id uuid; v_default_location uuid;
  v_quantity numeric; v_actual_price numeric; v_system_price numeric; v_total numeric(18,2);
  v_allocated numeric(18,2); v_paid numeric(18,2); v_credit numeric(18,2); v_cash numeric(18,2);
  v_amount numeric(18,2); v_method public.payment_method; v_bank_account_id uuid;
  v_bank_account public.bank_accounts%rowtype; v_bank public.payment_banks%rowtype;
  v_reference text; v_cheque_number text; v_cheque_date date; v_status text; v_primary_method public.payment_method;
  v_center public.centers%rowtype;
begin
  if not public.can_access_center(target_center) then raise exception 'Access denied for this center'; end if;
  select * into v_center from public.centers where id=target_center and is_active for update;
  v_org_id:=v_center.organization_id;
  if v_org_id is null or v_org_id<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
  if not exists(select 1 from public.suppliers where id=target_supplier and organization_id=v_org_id and is_active) then raise exception 'Invalid supplier'; end if;
  if jsonb_typeof(purchase_lines)<>'array' or jsonb_array_length(purchase_lines)=0 then raise exception 'At least one purchase line is required'; end if;
  if jsonb_typeof(payment_allocations)<>'array' or jsonb_array_length(payment_allocations)=0 then raise exception 'At least one payment allocation is required'; end if;
  select id into v_default_location from public.locations where center_id=target_center and is_default and is_active;
  if v_default_location is null then raise exception 'Center requires an active default location'; end if;

  v_po_number:='PO-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_order_number_seq')::text,5,'0');
  v_primary_method:=coalesce((payment_allocations->0->>'method')::public.payment_method,'credit'::public.payment_method);
  insert into public.purchase_orders(organization_id,center_id,supplier_id,po_number,payment_method,notes,created_by,payment_status)
  values(v_org_id,target_center,target_supplier,v_po_number,v_primary_method,nullif(trim(purchase_notes),''),auth.uid(),'unpaid') returning id into v_po_id;

  for v_item in select value from jsonb_array_elements(purchase_lines) loop
    v_product_id:=(v_item->>'product_id')::uuid; v_quality_id:=(v_item->>'quality_id')::uuid;
    v_location_id:=nullif(v_item->>'location_id','')::uuid; v_quantity:=(v_item->>'quantity')::numeric; v_actual_price:=(v_item->>'actual_price')::numeric;
    if v_quantity<=0 then raise exception 'Every quantity must be greater than zero'; end if;
    if v_actual_price<0 then raise exception 'Purchase price cannot be negative'; end if;
    if v_center.allow_multiple_locations and v_location_id is null then raise exception 'Location is required for every purchase line'; end if;
    v_location_id:=coalesce(v_location_id,v_default_location);
    if not exists(select 1 from public.locations where id=v_location_id and center_id=target_center and is_active) then raise exception 'Selected location does not belong to this center'; end if;
    select coalesce(cp.price,q.default_price) into v_system_price
      from public.product_qualities q join public.products p on p.id=q.product_id
      left join public.center_prices cp on cp.center_id=target_center and cp.quality_id=q.id
      where q.id=v_quality_id and q.product_id=v_product_id and p.organization_id=v_org_id and p.is_active and q.is_active;
    if v_system_price is null then raise exception 'Invalid product or quality'; end if;
    insert into public.purchase_order_lines(purchase_order_id,product_id,quality_id,location_id,quantity,system_price,actual_price)
    values(v_po_id,v_product_id,v_quality_id,v_location_id,v_quantity,v_system_price,v_actual_price);
  end loop;
  select round(sum(line_total),2) into v_total from public.purchase_order_lines where purchase_order_id=v_po_id;

  select round(coalesce(sum((value->>'amount')::numeric),0),2),
         round(coalesce(sum(case when value->>'method'='credit' then (value->>'amount')::numeric else 0 end),0),2),
         round(coalesce(sum(case when value->>'method'='cash' then (value->>'amount')::numeric else 0 end),0),2)
    into v_allocated,v_credit,v_cash from jsonb_array_elements(payment_allocations);
  v_paid:=v_allocated-v_credit;
  if exists(select 1 from jsonb_array_elements(payment_allocations) where nullif(value->>'amount','') is null or (value->>'amount')::numeric<=0) then raise exception 'Every payment amount must be greater than zero'; end if;
  if v_allocated<>v_total then raise exception 'Payment allocations (%) must equal purchase total (%)',v_allocated,v_total; end if;
  if public.center_cash_balance(target_center)<v_cash then raise exception 'Insufficient center cash balance for cash allocation'; end if;

  for v_allocation in select value from jsonb_array_elements(payment_allocations) loop
    begin v_method:=(v_allocation->>'method')::public.payment_method; exception when invalid_text_representation then raise exception 'Invalid payment method'; end;
    v_amount:=round((v_allocation->>'amount')::numeric,2); v_bank_account_id:=nullif(v_allocation->>'bank_account_id','')::uuid;
    v_reference:=nullif(trim(v_allocation->>'reference'),''); v_cheque_number:=nullif(trim(v_allocation->>'cheque_number'),''); v_cheque_date:=nullif(v_allocation->>'cheque_date','')::date;
    if v_method in ('bank_transfer','card','cheque') then
      select * into v_bank_account from public.bank_accounts where id=v_bank_account_id and organization_id=v_org_id and is_active;
      if not found then raise exception 'Select a valid active bank account'; end if;
      select * into v_bank from public.payment_banks where id=v_bank_account.bank_id and organization_id=v_org_id and is_active;
      if not found then raise exception 'The selected bank is inactive'; end if;
    end if;
    if v_method='cheque' and (v_cheque_number is null or v_cheque_date is null) then raise exception 'Cheque number and cheque date are required'; end if;
    if v_method<>'credit' then
      insert into public.payments(organization_id,center_id,purchase_order_id,method,amount,reference,cheque_number,cheque_date,created_by,bank_id,bank_account_id,bank_code,branch_code)
      values(v_org_id,target_center,v_po_id,v_method,v_amount,v_reference,v_cheque_number,v_cheque_date,auth.uid(),case when v_method in ('bank_transfer','card','cheque') then v_bank.id end,case when v_method in ('bank_transfer','card','cheque') then v_bank_account.id end,case when v_method in ('bank_transfer','card','cheque') then v_bank.code end,case when v_method in ('bank_transfer','card','cheque') then v_bank_account.branch_code end);
    end if;
  end loop;

  if v_cash>0 then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(v_org_id,target_center,'purchase',v_cash,'purchase_order',v_po_id,v_po_number||' cash allocation',auth.uid()); end if;
  if v_credit>0 then insert into public.supplier_payables(organization_id,center_id,supplier_id,purchase_order_id,original_amount,outstanding_amount,created_by) values(v_org_id,target_center,target_supplier,v_po_id,v_credit,v_credit,auth.uid()); end if;
  v_status:=case when v_credit=v_total then 'unpaid' when v_credit>0 then 'partially_paid' else 'paid' end;
  update public.purchase_orders set status='confirmed',total_amount=v_total,paid_amount=v_paid,credit_balance=v_credit,payment_status=v_status,payment_allocations=payment_allocations,confirmed_at=now(),confirmed_by=auth.uid(),updated_at=now() where id=v_po_id;
  insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
    select v_org_id,target_center,location_id,product_id,quality_id,'purchase_in',quantity,actual_price,'purchase_order',v_po_id,auth.uid() from public.purchase_order_lines where purchase_order_id=v_po_id;
  insert into public.notifications(organization_id,type,title,message,center_id,reference_id)
    select v_org_id,'price_override','Purchase price changed','One or more prices differ from the configured price on '||v_po_number,target_center,v_po_id
    where exists(select 1 from public.purchase_order_lines where purchase_order_id=v_po_id and actual_price<>system_price);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
    values(v_org_id,auth.uid(),'purchase_confirmed','purchase_order',v_po_id::text,jsonb_build_object('po_number',v_po_number,'total',v_total,'paid_amount',v_paid,'credit_balance',v_credit,'payment_status',v_status,'allocations',payment_allocations));
  return query select v_po_id,v_po_number,v_total,v_paid,v_credit,v_status;
end $$;

revoke all on function public.create_and_confirm_purchase_split(uuid,uuid,text,jsonb,jsonb) from public;
grant execute on function public.create_and_confirm_purchase_split(uuid,uuid,text,jsonb,jsonb) to authenticated;
