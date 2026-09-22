-- Remember the last confirmed seller-entered price and reuse it as the next default.
-- The seller can still change the price on every sale. Price memory is updated atomically only after confirmation.
begin;

-- Remember the most recently confirmed selling price per center and quality.
alter table public.sales_prices add column if not exists updated_at timestamptz not null default now();

-- The table used to hold admin-entered prices. From this migration onward it stores only
-- the last confirmed seller-entered price, so discard any stale manual setup values first.
delete from public.sales_prices;

-- If sales already exist from migration 019, use the newest confirmed line as the default.
insert into public.sales_prices(organization_id,center_id,quality_id,price,updated_at)
select distinct on (so.center_id,sol.quality_id) so.organization_id,so.center_id,sol.quality_id,sol.unit_price,so.confirmed_at
from public.sales_orders so
join public.sales_order_lines sol on sol.sales_order_id=so.id
order by so.center_id,sol.quality_id,so.confirmed_at desc,sol.id desc
on conflict(center_id,quality_id) do update
set organization_id=excluded.organization_id,price=excluded.price,updated_at=excluded.updated_at;

create or replace function public.confirm_center_sale(p_request uuid,p_center uuid,p_customer uuid,p_notes text,p_lines jsonb,p_payments jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_org uuid; v_id uuid; v_customer text; v_total numeric(18,2):=0; v_paid numeric(18,2):=0; v_credit numeric(18,2):=0; v_cash numeric(18,2):=0;
 v_line jsonb; v_pay jsonb; v_qty numeric; v_price numeric; v_available numeric; v_value numeric; v_cost numeric; v_amount numeric;
 v_method public.payment_method; v_account public.bank_accounts%rowtype; v_bank public.payment_banks%rowtype; v_number text;
begin
 if not public.sales_center_access(p_center) then raise exception 'Sales access denied'; end if;
 if p_request is null then raise exception 'Request ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select s.id into v_id from public.sales_orders s where s.request_id=p_request and s.center_id=p_center and s.created_by=auth.uid();
 if v_id is not null then return v_id; end if;
 select c.organization_id into v_org from public.centers c where c.id=p_center and c.is_active for update;
 if v_org is null then raise exception 'Active center required'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception 'Add 1 to 100 sale lines'; end if;
 if p_payments is null or jsonb_typeof(p_payments)<>'array' or jsonb_array_length(p_payments)=0 or jsonb_array_length(p_payments)>20 then raise exception 'Add 1 to 20 payment lines'; end if;
 if p_customer is not null then
  select c.name into v_customer from public.customers c where c.id=p_customer and c.center_id=p_center and c.organization_id=v_org and c.is_active;
  if v_customer is null then raise exception 'Invalid customer for this center'; end if;
 end if;
 for v_line in select jsonb_build_object('location_id',x->>'location_id','product_id',x->>'product_id','quality_id',x->>'quality_id','quantity',sum((x->>'quantity')::numeric)) from jsonb_array_elements(p_lines) x group by x->>'location_id',x->>'product_id',x->>'quality_id' loop
  select coalesce(sum(case when s.movement_type in ('purchase_in','transfer_in','adjustment_in') then s.quantity else -s.quantity end),0) into v_available from public.stock_movements s where s.center_id=p_center and s.location_id=(v_line->>'location_id')::uuid and s.product_id=(v_line->>'product_id')::uuid and s.quality_id=(v_line->>'quality_id')::uuid;
  if v_available<(v_line->>'quantity')::numeric then raise exception 'Insufficient stock for selected location'; end if;
 end loop;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_qty:=(v_line->>'quantity')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>=1000000000 or v_qty<>round(v_qty,3) then raise exception 'Quantity must be positive, with at most 3 decimals'; end if;
  if not exists(select 1 from public.locations l where l.id=(v_line->>'location_id')::uuid and l.center_id=p_center and l.is_active) then raise exception 'Invalid location'; end if;
  if not exists(select 1 from public.product_qualities q join public.products p on p.id=q.product_id where q.id=(v_line->>'quality_id')::uuid and p.id=(v_line->>'product_id')::uuid and p.organization_id=v_org and p.is_active and q.is_active) then raise exception 'Invalid active product or quality'; end if;
  v_price:=(v_line->>'unit_price')::numeric;
  if v_price is null or v_price<=0 or v_price>=1000000000000 or v_price<>round(v_price,2) then raise exception 'Enter a positive selling price with at most 2 decimals'; end if;
  if round(v_qty*v_price,2)<=0 then raise exception 'Line total must be positive'; end if;
  v_total:=v_total+round(v_qty*v_price,2);
 end loop;
 for v_pay in select value from jsonb_array_elements(p_payments) loop
  v_amount:=(v_pay->>'amount')::numeric; v_method:=(v_pay->>'method')::public.payment_method;
  if v_method is null or v_amount is null or v_amount<=0 or v_amount>=1000000000000 or v_amount<>round(v_amount,2) then raise exception 'Every payment needs a valid method and positive amount (2 decimals)'; end if;
  if v_method='credit' then v_credit:=v_credit+v_amount; else v_paid:=v_paid+v_amount; end if;
  if v_method='cash' then v_cash:=v_cash+v_amount; end if;
 end loop;
 if v_paid+v_credit<>v_total then raise exception 'Payment allocations must equal sale total'; end if;
 if v_credit>0 and p_customer is null then raise exception 'Customer required for credit'; end if;
 v_number:='SO-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.sales_order_number_seq')::text,6,'0');
 insert into public.sales_orders(request_id,organization_id,center_id,customer_id,customer_name,sale_number,total_amount,paid_amount,credit_balance,payment_status,notes,created_by)
 values(p_request,v_org,p_center,p_customer,coalesce(v_customer,'Walk-in customer'),v_number,v_total,v_paid,v_credit,case when v_credit=0 then 'paid' when v_paid=0 then 'unpaid' else 'partially_paid' end,nullif(trim(p_notes),''),auth.uid()) returning id into v_id;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_qty:=(v_line->>'quantity')::numeric; v_price:=(v_line->>'unit_price')::numeric;
  select sum(case when s.movement_type in ('purchase_in','transfer_in','adjustment_in') then s.quantity else -s.quantity end),sum(case when s.movement_type in ('purchase_in','transfer_in','adjustment_in') then s.quantity*s.unit_cost else -s.quantity*s.unit_cost end) into v_available,v_value from public.stock_movements s where s.center_id=p_center and s.location_id=(v_line->>'location_id')::uuid and s.product_id=(v_line->>'product_id')::uuid and s.quality_id=(v_line->>'quality_id')::uuid;
  v_cost:=greatest(0,round(v_value/nullif(v_available,0),2));
  insert into public.sales_order_lines(sales_order_id,product_id,quality_id,location_id,product_name,quality_name,unit,quantity,unit_price,unit_cost,line_total)
  select v_id,p.id,q.id,(v_line->>'location_id')::uuid,p.name,q.name,p.unit_of_measure,v_qty,v_price,v_cost,round(v_qty*v_price,2) from public.products p join public.product_qualities q on q.product_id=p.id where q.id=(v_line->>'quality_id')::uuid;
  insert into public.sales_prices(organization_id,center_id,quality_id,price,updated_at)
  values(v_org,p_center,(v_line->>'quality_id')::uuid,v_price,now())
  on conflict(center_id,quality_id) do update set organization_id=excluded.organization_id,price=excluded.price,updated_at=excluded.updated_at;
  insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) values(v_org,p_center,(v_line->>'location_id')::uuid,(v_line->>'product_id')::uuid,(v_line->>'quality_id')::uuid,'sale_out',v_qty,v_cost,'sales_order',v_id,auth.uid());
 end loop;
 for v_pay in select value from jsonb_array_elements(p_payments) loop
  v_method:=(v_pay->>'method')::public.payment_method; v_amount:=(v_pay->>'amount')::numeric;
  v_account:=null; v_bank:=null;
  if v_method in ('bank_transfer','card','cheque') then
   select * into v_account from public.bank_accounts b where b.id=nullif(v_pay->>'bank_account_id','')::uuid and b.organization_id=v_org and b.is_active for share;
   if not found then raise exception 'Active bank account required'; end if;
   select * into v_bank from public.payment_banks b where b.id=v_account.bank_id and b.organization_id=v_org and b.is_active for share;
   if not found then raise exception 'Selected bank inactive'; end if;
  end if;
  if v_method='cheque' and (nullif(trim(v_pay->>'cheque_number'),'') is null or nullif(v_pay->>'cheque_date','') is null) then raise exception 'Cheque number and date required'; end if;
  if v_method<>'credit' then
   insert into public.sales_payments(sales_order_id,method,amount,bank_account_id,bank_name,account_number,branch_name,branch_code,reference,cheque_number,cheque_date)
   values(v_id,v_method,v_amount,v_account.id,v_bank.name,v_account.account_number,v_account.branch_name,v_account.branch_code,nullif(trim(v_pay->>'reference'),''),case when v_method='cheque' then trim(v_pay->>'cheque_number') end,case when v_method='cheque' then (v_pay->>'cheque_date')::date end);
  end if;
 end loop;
 if v_cash>0 then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(v_org,p_center,'sale_receipt',v_cash,'sales_order',v_id,v_number||' cash received',auth.uid()); end if;
 if v_credit>0 then insert into public.customer_receivables(organization_id,center_id,customer_id,sales_order_id,original_amount,outstanding_amount) values(v_org,p_center,p_customer,v_id,v_credit,v_credit); end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(v_org,auth.uid(),'sale_confirmed','sales_order',v_id::text,jsonb_build_object('number',v_number,'total',v_total,'cash',v_cash,'credit',v_credit));
 return v_id;
end $$;

-- Selling prices are seller-entered. Prevent the old admin price RPC from overriding remembered values.
revoke execute on function public.set_sales_price(uuid,uuid,numeric) from authenticated;

commit;
