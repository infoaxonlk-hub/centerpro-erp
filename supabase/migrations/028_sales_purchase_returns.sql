begin;

-- Return requests are linked to their source bill lines. Approval applies the
-- available credit balance first; any excess remains as an unapplied credit note.
alter table public.sales_invoices drop constraint if exists sales_invoices_total_amount_check;
alter table public.sales_invoices add constraint sales_invoices_total_amount_check check (total_amount >= 0);

create table public.bill_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  center_id uuid not null references public.centers(id),
  bill_type text not null check (bill_type in ('sale','purchase')),
  bill_id uuid not null,
  bill_number text not null,
  reason text not null check (length(trim(reason)) > 0),
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  applied_to_due numeric(18,2) not null default 0 check (applied_to_due >= 0),
  unapplied_credit numeric(18,2) not null default 0 check (unapplied_credit >= 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);
create index bill_returns_center_date on public.bill_returns(center_id, requested_at desc);
create index bill_returns_bill on public.bill_returns(bill_type, bill_id, status);

create function public.prevent_bill_cancel_with_return()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_type text;
begin
  v_type:=case when tg_table_name='sales_orders' then 'sale' else 'purchase' end;
  if old.status='confirmed' and new.status='cancelled' and exists(
    select 1 from public.bill_returns r where r.bill_type=v_type and r.bill_id=old.id and r.status in ('pending','approved')
  ) then raise exception 'Resolve pending or approved return requests before cancelling this bill'; end if;
  return new;
end $$;
create trigger sales_cancel_requires_returns_resolved before update of status on public.sales_orders for each row execute function public.prevent_bill_cancel_with_return();
create trigger purchase_cancel_requires_returns_resolved before update of status on public.purchase_orders for each row execute function public.prevent_bill_cancel_with_return();

create table public.bill_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.bill_returns(id) on delete cascade,
  source_line_id uuid not null,
  product_id uuid not null references public.products(id),
  quality_id uuid not null references public.product_qualities(id),
  location_id uuid not null references public.locations(id),
  product_name text not null,
  quality_name text not null,
  unit text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  unit_cost numeric(18,2) not null check (unit_cost >= 0),
  line_total numeric(18,2) not null check (line_total > 0),
  created_at timestamptz not null default now(),
  unique(return_id, source_line_id)
);

alter table public.bill_returns enable row level security;
alter table public.bill_return_lines enable row level security;
create policy bill_returns_read on public.bill_returns for select
  using (organization_id=(public.current_profile()).organization_id and (
    public.is_admin() or
    (bill_type='sale' and public.sales_center_access(center_id)) or
    (bill_type='purchase' and public.has_permission('purchases') and public.can_access_center(center_id))
  ));
create policy bill_return_lines_read on public.bill_return_lines for select
  using (exists(select 1 from public.bill_returns r where r.id=return_id and r.organization_id=(public.current_profile()).organization_id and (
    public.is_admin() or
    (r.bill_type='sale' and public.sales_center_access(r.center_id)) or
    (r.bill_type='purchase' and public.has_permission('purchases') and public.can_access_center(r.center_id))
  )));
grant select on public.bill_returns, public.bill_return_lines to authenticated;

create function public.request_bill_return(p_type text, p_bill uuid, p_reason text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_org uuid; v_center uuid; v_number text; v_id uuid; v_customer text;
  v_line jsonb; v_source uuid; v_qty numeric; v_original numeric; v_returned numeric;
  v_product uuid; v_quality uuid; v_location uuid; v_product_name text; v_quality_name text; v_unit text;
  v_price numeric; v_cost numeric; v_total numeric(18,2):=0;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'Enter a return reason'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception 'Select at least one item to return'; end if;
  if p_type='sale' then
    select organization_id,center_id,sale_number into v_org,v_center,v_number from public.sales_orders where id=p_bill and status='confirmed' for update;
    if v_org is null or not public.sales_center_access(v_center) then raise exception 'Sales bill is unavailable'; end if;
  elsif p_type='purchase' then
    select organization_id,center_id,po_number into v_org,v_center,v_number from public.purchase_orders where id=p_bill and status='confirmed' for update;
    if v_org is null or not public.has_permission('purchases') or not public.can_access_center(v_center) then raise exception 'Purchase bill is unavailable'; end if;
  else raise exception 'Invalid return type'; end if;
  if v_org<>(public.current_profile()).organization_id then raise exception 'Bill not found'; end if;

  insert into public.bill_returns(organization_id,center_id,bill_type,bill_id,bill_number,reason,total_amount,requested_by)
  values(v_org,v_center,p_type,p_bill,v_number,trim(p_reason),0,auth.uid()) returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_source:=(v_line->>'line_id')::uuid; v_qty:=(v_line->>'quantity')::numeric;
    if v_qty is null or v_qty<=0 or v_qty<>round(v_qty,3) then raise exception 'Return quantity must be positive and use at most 3 decimals'; end if;
    if p_type='sale' then
      select l.quantity,l.product_id,l.quality_id,l.location_id,l.product_name,l.quality_name,l.unit,l.unit_price,l.unit_cost
        into v_original,v_product,v_quality,v_location,v_product_name,v_quality_name,v_unit,v_price,v_cost
        from public.sales_order_lines l where l.id=v_source and l.sales_order_id=p_bill;
    else
      select l.quantity,l.product_id,l.quality_id,l.location_id,p.name,q.name,p.unit_of_measure,l.actual_price,l.actual_price
        into v_original,v_product,v_quality,v_location,v_product_name,v_quality_name,v_unit,v_price,v_cost
        from public.purchase_order_lines l join public.purchase_orders o on o.id=l.purchase_order_id
        join public.products p on p.id=l.product_id join public.product_qualities q on q.id=l.quality_id
        where l.id=v_source and l.purchase_order_id=p_bill;
    end if;
    if v_original is null then raise exception 'Selected item does not belong to this bill'; end if;
    select coalesce(sum(rl.quantity),0) into v_returned from public.bill_return_lines rl
      join public.bill_returns r on r.id=rl.return_id
      where r.bill_type=p_type and r.bill_id=p_bill and r.status in ('pending','approved') and rl.source_line_id=v_source;
    if v_returned+v_qty>v_original then raise exception 'Return quantity exceeds the unreturned quantity for %',v_product_name; end if;
    if round(v_qty*v_price,2)<=0 then raise exception 'Return value must be greater than zero'; end if;
    insert into public.bill_return_lines(return_id,source_line_id,product_id,quality_id,location_id,product_name,quality_name,unit,quantity,unit_price,unit_cost,line_total)
    values(v_id,v_source,v_product,v_quality,v_location,v_product_name,v_quality_name,v_unit,v_qty,v_price,v_cost,round(v_qty*v_price,2));
    v_total:=v_total+round(v_qty*v_price,2);
  end loop;
  update public.bill_returns set total_amount=v_total where id=v_id;
  insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
  values(v_org,'bill_return_request','Return request',v_number||' · LKR '||v_total||' · '||trim(p_reason),v_center,v_id,'admin');
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(v_org,auth.uid(),'bill_return_requested','bill_return',v_id::text,jsonb_build_object('bill_type',p_type,'bill_id',p_bill,'amount',v_total,'reason',p_reason));
  return v_id;
end $$;

create function public.review_bill_return(p_return uuid,p_approve boolean,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare
  r public.bill_returns%rowtype; so public.sales_orders%rowtype; po public.purchase_orders%rowtype; si public.sales_invoices%rowtype;
  ln record; v_available numeric; v_applied numeric(18,2); v_credit numeric(18,2); v_new_due numeric(18,2);
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into r from public.bill_returns where id=p_return for update;
  if not found or r.status<>'pending' or r.organization_id<>(public.current_profile()).organization_id then raise exception 'Pending return request not found'; end if;
  if p_approve then
    if r.bill_type='sale' then
      select * into si from public.sales_invoices where sales_order_id=r.bill_id for update;
      if not found then raise exception 'Sales invoice was not found'; end if;
      perform 1 from public.customer_receivables where sales_order_id=r.bill_id and not is_void for update;
      select * into so from public.sales_orders where id=r.bill_id and status='confirmed' for update;
      if not found then raise exception 'Sales bill is no longer active'; end if;
      for ln in select * from public.bill_return_lines where return_id=r.id loop
        insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
        values(r.organization_id,r.center_id,ln.location_id,ln.product_id,ln.quality_id,'adjustment_in',ln.quantity,ln.unit_cost,'sales_return',r.id,auth.uid());
      end loop;
      select greatest(0,least(r.total_amount,so.credit_balance,si.outstanding_amount)) into v_applied;
      v_credit:=greatest(0,so.credit_balance-v_applied);
      update public.sales_orders set total_amount=greatest(paid_amount,total_amount-v_applied),credit_balance=v_credit,
        payment_status=case when v_credit=0 then 'paid' when paid_amount=0 then 'unpaid' else 'partially_paid' end where id=so.id;
      update public.sales_invoices set total_amount=greatest(0,total_amount-v_applied),outstanding_amount=greatest(0,outstanding_amount-v_applied),
        status=case when greatest(0,outstanding_amount-v_applied)=0 then 'paid' when so.paid_amount=0 then 'unpaid' else 'partially_paid' end
        where sales_order_id=so.id;
      update public.customer_receivables set outstanding_amount=greatest(0,outstanding_amount-v_applied)
        where sales_order_id=so.id and not is_void;
    else
      perform 1 from public.supplier_payables where purchase_order_id=r.bill_id and status<>'void' for update;
      select * into po from public.purchase_orders where id=r.bill_id and status='confirmed' for update;
      if not found then raise exception 'Purchase bill is no longer active'; end if;
      for ln in select * from public.bill_return_lines where return_id=r.id loop
        select coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity else -quantity end),0)
          into v_available from public.stock_movements where center_id=r.center_id and location_id=ln.location_id and product_id=ln.product_id and quality_id=ln.quality_id;
        if v_available<ln.quantity then raise exception 'Not enough stock to return this purchase item'; end if;
        insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
        values(r.organization_id,r.center_id,ln.location_id,ln.product_id,ln.quality_id,'adjustment_out',ln.quantity,ln.unit_cost,'purchase_return',r.id,auth.uid());
      end loop;
      select least(r.total_amount,po.credit_balance,coalesce(sp.outstanding_amount,0)) into v_applied from public.supplier_payables sp where sp.purchase_order_id=po.id and sp.status<>'void';
      v_applied:=coalesce(v_applied,0); v_credit:=greatest(0,po.credit_balance-v_applied);
      update public.purchase_orders set total_amount=greatest(paid_amount,total_amount-v_applied),credit_balance=v_credit,
        payment_status=case when v_credit=0 then 'paid' when paid_amount=0 then 'unpaid' else 'partially_paid' end,updated_at=now() where id=po.id;
      update public.supplier_payables set outstanding_amount=greatest(0,outstanding_amount-v_applied),
        status=case when greatest(0,outstanding_amount-v_applied)=0 then 'paid' else 'partially_paid' end,updated_at=now()
        where purchase_order_id=po.id and status<>'void';
    end if;
    v_new_due:=greatest(0,r.total_amount-v_applied);
    update public.bill_returns set applied_to_due=v_applied,unapplied_credit=v_new_due,status='approved',reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(p_note),'') where id=r.id;
  else
    update public.bill_returns set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(p_note),'') where id=r.id;
  end if;
  insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
  values(r.organization_id,'bill_return_review','Return '||case when p_approve then 'approved' else 'rejected' end,r.bill_number||' · LKR '||r.total_amount,r.center_id,r.id,'center');
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(r.organization_id,auth.uid(),'bill_return_'||case when p_approve then 'approved' else 'rejected' end,'bill_return',r.id::text,jsonb_build_object('bill_type',r.bill_type,'bill_id',r.bill_id,'amount',r.total_amount,'applied_to_due',case when p_approve then v_applied else 0 end,'unapplied_credit',case when p_approve then v_new_due else 0 end,'note',p_note));
end $$;

revoke all on function public.request_bill_return(text,uuid,text,jsonb), public.review_bill_return(uuid,boolean,text) from public;
grant execute on function public.request_bill_return(text,uuid,text,jsonb), public.review_bill_return(uuid,boolean,text) to authenticated;

commit;
