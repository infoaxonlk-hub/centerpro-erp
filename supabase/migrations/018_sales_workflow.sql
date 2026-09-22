begin;
create table public.customers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 center_id uuid not null references public.centers, name text not null check(length(trim(name))>0),
 phone text, address text, is_active boolean not null default true,
 created_by uuid not null references public.profiles, created_at timestamptz not null default now()
);
create table public.sales_prices (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 center_id uuid not null references public.centers, quality_id uuid not null references public.product_qualities,
 price numeric(18,2) not null check(price>0 and price<1000000000000), unique(center_id,quality_id)
);
create sequence public.sales_order_number_seq;
create table public.sales_orders (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 organization_id uuid not null references public.organizations, center_id uuid not null references public.centers,
 customer_id uuid references public.customers, customer_name text not null,
 sale_number text not null unique, total_amount numeric(18,2) not null check(total_amount>0),
 paid_amount numeric(18,2) not null check(paid_amount>=0), credit_balance numeric(18,2) not null check(credit_balance>=0),
 payment_status text not null check(payment_status in ('paid','partially_paid','unpaid')),
 notes text, created_by uuid not null references public.profiles, confirmed_at timestamptz not null default now(),
 check(total_amount=paid_amount+credit_balance)
);
create table public.sales_order_lines (
 id uuid primary key default gen_random_uuid(), sales_order_id uuid not null references public.sales_orders,
 product_id uuid not null references public.products, quality_id uuid not null references public.product_qualities,
 location_id uuid not null references public.locations, product_name text not null, quality_name text not null, unit text not null,
 quantity numeric(18,3) not null check(quantity>0), unit_price numeric(18,2) not null check(unit_price>0),
 unit_cost numeric(18,2) not null check(unit_cost>=0), line_total numeric(18,2) not null check(line_total>0)
);
create table public.sales_payments (
 id uuid primary key default gen_random_uuid(), sales_order_id uuid not null references public.sales_orders,
 method public.payment_method not null check(method<>'credit'), amount numeric(18,2) not null check(amount>0),
 bank_account_id uuid references public.bank_accounts, bank_name text, account_number text, branch_name text, branch_code text,
 reference text, cheque_number text, cheque_date date, created_at timestamptz not null default now()
);
create table public.customer_receivables (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 center_id uuid not null references public.centers, customer_id uuid not null references public.customers,
 sales_order_id uuid not null unique references public.sales_orders, original_amount numeric(18,2) not null check(original_amount>0),
 outstanding_amount numeric(18,2) not null check(outstanding_amount>=0), created_at timestamptz not null default now()
);
create index on public.sales_orders(center_id,confirmed_at);
create index on public.sales_order_lines(sales_order_id);
create index on public.sales_payments(sales_order_id);
create index on public.customer_receivables(center_id,customer_id);
-- Existing purchase operators receive the approved counterpart Sales module.
update public.profiles set permissions=array_append(permissions,'sales') where (role in ('admin','super_admin') or 'purchases'=any(permissions)) and not ('sales'=any(permissions));
create function public.sales_center_access(p_center uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.has_permission('sales') and exists(select 1 from public.centers c where c.id=p_center and c.organization_id=(public.current_profile()).organization_id and public.can_access_center(c.id))
$$;
alter table public.customers enable row level security;
alter table public.sales_prices enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;
alter table public.sales_payments enable row level security;
alter table public.customer_receivables enable row level security;
create policy sales_customers_read on public.customers for select using(public.sales_center_access(center_id));
create policy sales_prices_read on public.sales_prices for select using(public.sales_center_access(center_id));
create policy sales_orders_read on public.sales_orders for select using(public.sales_center_access(center_id));
create policy sales_lines_read on public.sales_order_lines for select using(exists(select 1 from public.sales_orders s where s.id=sales_order_id and public.sales_center_access(s.center_id)));
create policy sales_payments_read on public.sales_payments for select using(exists(select 1 from public.sales_orders s where s.id=sales_order_id and public.sales_center_access(s.center_id)));
create policy sales_receivables_read on public.customer_receivables for select using(public.sales_center_access(center_id));
grant select on public.customers,public.sales_prices,public.sales_orders,public.sales_order_lines,public.sales_payments,public.customer_receivables to authenticated;
create function public.create_sales_customer(p_center uuid,p_name text,p_phone text,p_address text) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_org uuid;
begin
 if not public.sales_center_access(p_center) then raise exception 'Sales access denied'; end if;
 select organization_id into v_org from public.centers where id=p_center and is_active;
 if v_org is null or nullif(trim(p_name),'') is null then raise exception 'Active center and customer name required'; end if;
 insert into public.customers(organization_id,center_id,name,phone,address,created_by) values(v_org,p_center,trim(p_name),nullif(trim(p_phone),''),nullif(trim(p_address),''),auth.uid()) returning id into v_id;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(v_org,auth.uid(),'customer_created','customer',v_id::text,jsonb_build_object('name',p_name));
 return v_id;
end $$;
create function public.set_sales_price(p_center uuid,p_quality uuid,p_price numeric) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid;
begin
 if not public.is_admin() or not public.sales_center_access(p_center) then raise exception 'Admin sales access required'; end if;
 select organization_id into v_org from public.centers where id=p_center and is_active;
 if v_org is null or not exists(select 1 from public.product_qualities q join public.products p on p.id=q.product_id where q.id=p_quality and q.is_active and p.is_active and p.organization_id=v_org) then raise exception 'Invalid center or product'; end if;
 if p_price is null or p_price<=0 or p_price>=1000000000000 then raise exception 'Enter a positive selling price'; end if;
 insert into public.sales_prices(organization_id,center_id,quality_id,price) values(v_org,p_center,p_quality,round(p_price,2)) on conflict(center_id,quality_id) do update set price=excluded.price;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(v_org,auth.uid(),'sales_price_set','sales_price',p_quality::text,jsonb_build_object('center',p_center,'price',p_price));
end $$;
create function public.sales_stock(p_center uuid) returns table(location_id uuid,product_id uuid,quality_id uuid,quantity numeric)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.sales_center_access(p_center) then raise exception 'Sales access denied'; end if;
 return query select s.location_id,s.product_id,s.quality_id,sum(case when s.movement_type in ('purchase_in','transfer_in','adjustment_in') then s.quantity else -s.quantity end)
 from public.stock_movements s where s.center_id=p_center group by s.location_id,s.product_id,s.quality_id;
end $$;
create function public.confirm_center_sale(p_request uuid,p_center uuid,p_customer uuid,p_notes text,p_lines jsonb,p_payments jsonb)
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
  select sp.price into v_price from public.sales_prices sp join public.product_qualities q on q.id=sp.quality_id join public.products p on p.id=q.product_id where sp.center_id=p_center and q.id=(v_line->>'quality_id')::uuid and p.id=(v_line->>'product_id')::uuid and p.organization_id=v_org and p.is_active and q.is_active for share of sp;
  if v_price is null or (v_line->>'unit_price') is null or v_price<>(v_line->>'unit_price')::numeric then raise exception 'Selling price missing or changed. Refresh the sale'; end if;
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
create or replace function public.center_cash_balance(target_center uuid) returns numeric language sql stable security definer set search_path=public as $$
 select coalesce(sum(case when movement_type in ('allocation','refund','sale_receipt') then amount else -amount end),0) from public.cash_ledger where center_id=target_center
$$;
revoke all on function public.sales_center_access(uuid),public.create_sales_customer(uuid,text,text,text),public.set_sales_price(uuid,uuid,numeric),public.sales_stock(uuid),public.confirm_center_sale(uuid,uuid,uuid,text,jsonb,jsonb) from public;
grant execute on function public.sales_center_access(uuid),public.create_sales_customer(uuid,text,text,text),public.set_sales_price(uuid,uuid,numeric),public.sales_stock(uuid),public.confirm_center_sale(uuid,uuid,uuid,text,jsonb,jsonb) to authenticated;
commit;
