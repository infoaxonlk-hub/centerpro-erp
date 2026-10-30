begin;
-- 056/057 are already reserved on main. This feature branch intentionally starts
-- at 055; 058 is also additive when later integrated with the production branch.
insert into public.business_module_catalog(key,name,mandatory) values('farm_services','Farm Services',false);
alter table public.organizations add column receipt_logo_url text;
create function public.update_company_profile_with_logo(p_name text,p_address text,p_phone text,p_email text,p_logo text) returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.assert_business_operation('users');
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 if nullif(trim(p_logo),'') is not null and (length(p_logo)>2048 or p_logo!~'^(https://|/[^/])') then raise exception 'Logo must use an HTTPS or local image URL';end if;
 perform public.update_company_profile(p_name,p_address,p_phone,p_email);
 update public.organizations set receipt_logo_url=nullif(trim(p_logo),'') where id=(public.current_profile()).organization_id;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values((public.current_profile()).organization_id,auth.uid(),'receipt_logo_updated','organization',(public.current_profile()).organization_id::text,jsonb_build_object('logo',nullif(trim(p_logo),'')));
end $$;
revoke all on function public.update_company_profile_with_logo(text,text,text,text,text) from public,anon;
grant execute on function public.update_company_profile_with_logo(text,text,text,text,text) to authenticated;
alter table public.products add column product_type text not null default 'stock' check(product_type in ('stock','service'));
alter table public.products add constraint service_product_settings check(product_type='stock' or
 (unit_of_measure in ('Acre','Hour') and can_be_sold and not can_be_purchased and not can_be_manufactured and not tracks_sacks and not tracks_purchase_lots and default_sales_price is not null));
create table public.farm_seasons(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,
 name text not null check(length(trim(name)) between 1 and 120),is_active boolean not null default true,is_default boolean not null default false,
 created_by uuid not null references public.profiles,created_at timestamptz not null default now(),unique(organization_id,name),check(not is_default or is_active));
create unique index farm_one_default_season on public.farm_seasons(organization_id) where is_default;
alter table public.sales_orders add column order_source text not null default 'stock' check(order_source in ('stock','farm_services')),
 add column season_id uuid references public.farm_seasons,add column season_name text,
 add column service_location text,add column service_description text,
 add column service_subtotal numeric(18,2),add column service_adjustments jsonb not null default '[]'::jsonb;
alter table public.sales_orders add constraint farm_order_metadata check(order_source='stock' or (customer_id is not null and season_id is not null and service_subtotal>0));
alter table public.sales_order_lines alter column location_id drop not null;
create table public.farm_collection_requests(
 request_id uuid primary key,organization_id uuid not null references public.organizations,invoice_id uuid not null references public.sales_invoices,
 created_by uuid not null references public.profiles,amount numeric(18,2) not null,method public.payment_method not null,
 created_at timestamptz not null default now());
create index farm_orders_filter on public.sales_orders(organization_id,order_source,confirmed_at,season_id,customer_id);

do $$ declare d text;begin
 d:=pg_get_functiondef('public.business_module_user_allowed(text)'::regprocedure);
 d:=replace(d,'when ''audit'' then','when ''farm_services'' then ''farm_services''=any(p.permissions) when ''audit'' then');execute d;
 d:=pg_get_functiondef('public.platform_grant_business_admin_access(uuid,uuid,uuid)'::regprocedure);
 d:=replace(d,'when ''dashboard'' then array[''dashboard'']','when ''farm_services'' then array[''farm_services'',''farm_services_manage''] when ''dashboard'' then array[''dashboard'']');execute d;
 -- Retain every existing module mapping, including whichever manufacturing version is installed.
 d:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 d:=replace(d,E'\n case',E'\n if p_table in (''farm_seasons'',''farm_collection_requests'') then return array[''farm_services'']; end if;\n if p_table=''customers'' then return array[''sales'',''farm_services'']; end if;\n if p_table=''sales_orders'' and p_row->>''order_source''=''farm_services'' then return array[''sales'',''farm_services'',''payment_reports'']; end if;\n if p_table in (''sales_order_lines'',''sales_payments'') and exists(select 1 from public.sales_orders where id=(p_row->>''sales_order_id'')::uuid and order_source=''farm_services'') then return array[''sales'',''farm_services'',''payment_reports'']; end if;\n if not p_write and p_table in (''products'',''product_qualities'',''product_categories'',''bank_accounts'',''payment_banks'',''sales_invoices'',''customer_receivables'',''sales_credit_settlements'') then return array[''farm_services'']||case when p_table in (''sales_invoices'',''customer_receivables'',''sales_credit_settlements'') then array[''sales'',''customer_receivables'',''payment_reports''] when p_table in (''bank_accounts'',''payment_banks'') then array[''bank'',''cash'',''purchases'',''sales'',''expenses'',''payment_reports'',''cheques''] else array[''masters'',''sales'',''purchases'',''inventory'',''stock_adjustments'',''manufacturing''] end; end if;\n case');
 if position('farm_seasons' in d)=0 then raise exception 'Module mapping marker missing';end if;execute d;
 d:=pg_get_functiondef('public.assert_business_finance_access()'::regprocedure);
 d:=replace(d,'''cash'',''purchases'',''sales''','''farm_services'',''cash'',''purchases'',''sales''');execute d;
end $$;
create function public.farm_center_access(p_center uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.has_permission('farm_services') and public.business_module_enabled((public.current_profile()).organization_id,'farm_services') and public.can_access_center(p_center)
 and exists(select 1 from public.centers where id=p_center and organization_id=(public.current_profile()).organization_id)
$$;
revoke all on function public.farm_center_access(uuid) from public,anon;grant execute on function public.farm_center_access(uuid) to authenticated;
create policy farm_customer_read on public.customers for select to authenticated using(public.farm_center_access(center_id));
create policy farm_order_read on public.sales_orders for select to authenticated using(order_source='farm_services' and public.farm_center_access(center_id));
create policy farm_line_read on public.sales_order_lines for select to authenticated using(exists(select 1 from public.sales_orders where id=sales_order_id and order_source='farm_services' and public.farm_center_access(center_id)));
create policy farm_payment_read on public.sales_payments for select to authenticated using(exists(select 1 from public.sales_orders where id=sales_order_id and order_source='farm_services' and public.farm_center_access(center_id)));
-- Shared invoices/receivables belong to the customer account, not a separate farmer ledger.
create policy farm_invoice_read on public.sales_invoices for select to authenticated using(public.farm_center_access(center_id));
create policy farm_receivable_read on public.customer_receivables for select to authenticated using(public.farm_center_access(center_id));
do $$ declare t text;begin
 foreach t in array array['farm_seasons','farm_collection_requests'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy tenant_boundary on public.%I as restrictive for all to authenticated using(organization_id=(public.current_profile()).organization_id) with check(organization_id=(public.current_profile()).organization_id)',t);
 execute format('create policy business_operation_boundary on public.%I as restrictive for all to authenticated using(public.business_table_access(%L,to_jsonb(%I),false)) with check(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t,t,t);
 execute format('create policy business_delete_boundary on public.%I as restrictive for delete to authenticated using(public.business_table_access(%L,to_jsonb(%I),true))',t,t,t);
 if t='farm_seasons' then
 execute format('create policy farm_read on public.%I for select to authenticated using(public.has_permission(''farm_services''))',t);
 else
 execute format('create policy farm_read on public.%I for select to authenticated using(exists(select 1 from public.sales_invoices where id=invoice_id and public.farm_center_access(center_id)))',t);
 end if;
 execute format('create trigger tenant_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write()',t);
 execute format('create trigger business_operation_guard before insert or update or delete on public.%I for each row execute function public.enforce_business_operation()',t);
 end loop;
end $$;

create function public.farm_number(p_value text,p_decimals integer default 2,p_zero boolean default true) returns numeric language plpgsql immutable as $$
declare n numeric;begin
 if p_value is null or p_value!~'^[0-9]+(\.[0-9]+)?$' then raise exception 'Enter a finite non-negative number';end if;
 n:=p_value::numeric;if n>=1000000000 or n<>round(n,p_decimals) or (not p_zero and n<=0) then raise exception 'Invalid amount or decimal precision';end if;return n;
end $$;
revoke all on function public.farm_number(text,integer,boolean) from public,anon,authenticated;
create function public.save_farm_season(p_id uuid,p_name text,p_active boolean default true,p_default boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid;result uuid;begin
 perform public.assert_business_operation('farm_services');org:=(public.current_profile()).organization_id;
 if length(trim(coalesce(p_name,''))) not between 1 and 120 or p_active is null or p_default is null or (p_default and not p_active) then raise exception 'Valid season name and settings required';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text,58));
 if p_default then update public.farm_seasons set is_default=false where organization_id=org and is_default;end if;
 if p_id is null then insert into public.farm_seasons(organization_id,name,is_active,is_default,created_by) values(org,trim(p_name),p_active,p_default,auth.uid()) returning id into result;
 else update public.farm_seasons set name=trim(p_name),is_active=p_active,is_default=p_default where id=p_id and organization_id=org returning id into result;if result is null then raise exception 'Season unavailable';end if;end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'farm_season_saved','farm_season',result::text,jsonb_build_object('name',p_name,'active',p_active,'default',p_default));return result;
end $$;
create function public.save_farm_service(p_id uuid,p_code text,p_name text,p_unit text,p_rate numeric,p_active boolean default true) returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid;result uuid;begin
 perform public.assert_business_operation('farm_services');org:=(public.current_profile()).organization_id;
 if not (public.is_admin() or public.has_permission('farm_services_manage')) then raise exception 'Service management permission required';end if;
 perform public.farm_number(p_rate::text,2,true);
 if p_unit not in ('Acre','Hour') or p_unit is null or length(trim(coalesce(p_name,''))) not between 1 and 200 or length(trim(coalesce(p_code,''))) not between 1 and 60 then raise exception 'Service code, name and Acre/Hour unit required';end if;
 if p_id is null then
 insert into public.products(organization_id,code,name,unit_of_measure,product_type,default_sales_price,can_be_sold,can_be_purchased,can_be_manufactured,tracks_sacks,tracks_purchase_lots,is_active)
 values(org,trim(p_code),trim(p_name),p_unit,'service',p_rate,true,false,false,false,false,p_active) returning id into result;
 insert into public.product_qualities(product_id,name,default_price,is_base) values(result,'Standard',0,true);
 else update public.products set code=trim(p_code),name=trim(p_name),unit_of_measure=p_unit,default_sales_price=p_rate,is_active=p_active where id=p_id and organization_id=org and product_type='service' returning id into result;
 if result is null then raise exception 'Service unavailable';end if;end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'farm_service_saved','product',result::text,jsonb_build_object('name',p_name,'unit',p_unit,'rate',p_rate));return result;
end $$;
-- Use the existing customer validation and audit implementation without granting Sales access.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.create_sales_customer(uuid,text,text,text)'::regprocedure);
 d:=replace(d,'FUNCTION public.create_sales_customer(','FUNCTION public._farm_create_customer(');
 d:=replace(d,'public.sales_center_access(','public.farm_center_access(');
 d:=replace(d,'assert_business_operation(''sales'')','assert_business_operation(''farm_services'')');execute d;
 d:=pg_get_functiondef('public.receive_invoice_payment(uuid,numeric,public.payment_method,uuid,text)'::regprocedure);
 d:=replace(d,'FUNCTION public.receive_invoice_payment(','FUNCTION public._farm_receive_payment(');
 d:=replace(d,'public.sales_center_access(','public.farm_center_access(');
 d:=replace(d,'assert_business_operation(''customer_receivables'')','assert_business_operation(''farm_services'')');execute d;
end $$;
revoke all on function public._farm_create_customer(uuid,text,text,text),public._farm_receive_payment(uuid,numeric,public.payment_method,uuid,text) from public,anon,authenticated;
create function public.create_farm_customer(p_center uuid,p_name text,p_phone text default null,p_address text default null) returns uuid language plpgsql security definer set search_path=public as $$
begin perform public.assert_business_operation('farm_services');if length(trim(coalesce(p_name,''))) not between 1 and 200 or length(coalesce(p_phone,''))>40 or length(coalesce(p_address,''))>500 then raise exception 'Invalid customer details';end if;return public._farm_create_customer(p_center,p_name,p_phone,p_address);end $$;

create function public.confirm_farm_sale(p_request uuid,p_center uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid;result uuid;existing public.sales_orders;cust public.customers;svc public.products;season public.farm_seasons;quality uuid;
 qty numeric;rate numeric;subtotal numeric;total numeric;charge numeric:=0;deduction numeric:=0;paid numeric;due numeric;adjustment jsonb;adjustments jsonb:='[]';kind text;v_amount numeric;
 pay_method public.payment_method;account public.bank_accounts;bank public.payment_banks;number text;
begin
 perform public.assert_business_operation('farm_services');
 if not public.farm_center_access(p_center) or p_request is null then raise exception 'Farm Services center access denied';end if;
 org:=(public.current_profile()).organization_id;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into existing from public.sales_orders where request_id=p_request;
 if found then if existing.organization_id<>org or existing.created_by<>auth.uid() or existing.center_id<>p_center or existing.order_source<>'farm_services' then raise exception 'Request ID unavailable';end if;return existing.id;end if;
 perform 1 from public.centers where id=p_center and is_active for update;if not found then raise exception 'Active center required';end if;
 select * into cust from public.customers where id=(p_data->>'customer_id')::uuid and organization_id=org and center_id=p_center and is_active for share;
 if not found then raise exception 'Select an active customer for this center';end if;
 select * into season from public.farm_seasons where id=(p_data->>'season_id')::uuid and organization_id=org and is_active for share;
 if not found then raise exception 'Select an active season';end if;
 select * into svc from public.products where id=(p_data->>'service_id')::uuid and organization_id=org and is_active and product_type='service' and can_be_sold for share;
 if not found then raise exception 'Select an active service';end if;
 select id into quality from public.product_qualities where product_id=svc.id and is_base and is_active;
 if quality is null then raise exception 'Service standard quality unavailable';end if;
 qty:=public.farm_number(p_data->>'quantity',3,false);rate:=public.farm_number(p_data->>'rate',2,true);subtotal:=round(qty*rate,2);
 if jsonb_typeof(coalesce(p_data->'adjustments','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'adjustments','[]'))>20 then raise exception 'Up to 20 adjustments allowed';end if;
 for adjustment in select value from jsonb_array_elements(coalesce(p_data->'adjustments','[]')) loop
 kind:=adjustment->>'kind';v_amount:=public.farm_number(adjustment->>'amount',2,true);
 if kind is null or kind not in ('charge','deduction') or length(trim(coalesce(adjustment->>'description',''))) not between 1 and 200 then raise exception 'Adjustment kind and description required';end if;
 if kind='charge' then charge:=charge+v_amount;else deduction:=deduction+v_amount;end if;
 adjustments:=adjustments||jsonb_build_array(jsonb_build_object('kind',kind,'description',trim(adjustment->>'description'),'amount',v_amount));end loop;
 total:=subtotal+charge-deduction;
 -- Existing invoices/lines require positive amounts. Zero-total bills remain disallowed.
 if subtotal<=0 or total<=0 or total>=1000000000000 then raise exception 'Bill subtotal and final total must be positive';end if;
 kind:=p_data->>'payment';if kind is null or kind not in ('cash','bank_transfer','credit') then raise exception 'Choose Cash, Bank or Credit';end if;
 paid:=case when kind='credit' then public.farm_number(coalesce(p_data->>'initial_paid','0'),2,true) else total end;
 if paid>total then raise exception 'Payment cannot exceed bill total';end if;due:=total-paid;
 if paid>0 then
 pay_method:=case when kind='credit' then (p_data->>'initial_method')::public.payment_method else kind::public.payment_method end;
 if pay_method is null or pay_method not in ('cash','bank_transfer') then raise exception 'Initial paid portion requires Cash or Bank';end if;
 if pay_method='bank_transfer' then
 select * into account from public.bank_accounts where id=nullif(p_data->>'bank_account_id','')::uuid and organization_id=org and is_active for share;if not found then raise exception 'Active business bank account required';end if;
 select * into bank from public.payment_banks where id=account.bank_id and organization_id=org and is_active for share;if not found then raise exception 'Active bank required';end if;end if;end if;
 if length(coalesce(p_data->>'location',''))>500 or length(coalesce(p_data->>'description',''))>1000 then raise exception 'Location or description is too long';end if;
 number:='FS-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.sales_order_number_seq')::text,6,'0');
 insert into public.sales_orders(request_id,organization_id,center_id,customer_id,customer_name,sale_number,total_amount,paid_amount,credit_balance,payment_status,created_by,order_source,season_id,season_name,service_location,service_description,service_subtotal,service_adjustments)
 values(p_request,org,p_center,cust.id,cust.name,number,total,paid,due,case when due=0 then 'paid' when paid=0 then 'unpaid' else 'partially_paid' end,auth.uid(),'farm_services',season.id,season.name,nullif(trim(p_data->>'location'),''),coalesce(nullif(trim(p_data->>'description'),''),svc.name),subtotal,adjustments) returning id into result;
 insert into public.sales_order_lines(sales_order_id,product_id,quality_id,location_id,product_name,quality_name,unit,quantity,unit_price,unit_cost,line_total)
 values(result,svc.id,quality,null,svc.name,'',svc.unit_of_measure,qty,rate,0,subtotal);
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales_order_lines' and column_name='cogs_value') then execute 'update public.sales_order_lines set cogs_value=0 where sales_order_id=$1' using result;end if;
 if paid>0 then
 insert into public.sales_payments(sales_order_id,method,amount,bank_account_id,bank_name,account_number,branch_name,branch_code,reference)
 values(result,pay_method,paid,account.id,bank.name,account.account_number,account.branch_name,account.branch_code,nullif(trim(p_data->>'reference'),''));
 if pay_method='cash' then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(org,p_center,'sale_receipt',paid,'sales_order',result,number||' cash received',auth.uid());end if;end if;
 if due>0 then insert into public.customer_receivables(organization_id,center_id,customer_id,sales_order_id,original_amount,outstanding_amount) values(org,p_center,cust.id,result,due,due);end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'farm_sale_confirmed','sales_order',result::text,jsonb_build_object('number',number,'total',total,'paid',paid,'credit',due));return result;
end $$;

create function public.collect_farm_invoice(p_request uuid,p_invoice uuid,p_amount numeric,p_method public.payment_method,p_bank_account uuid default null,p_reference text default null) returns void language plpgsql security definer set search_path=public as $$
declare i public.sales_invoices;r public.farm_collection_requests;begin
 perform public.assert_business_operation('farm_services');if p_request is null then raise exception 'Request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,58));
 select * into r from public.farm_collection_requests where request_id=p_request;
 if found then if r.organization_id<>(public.current_profile()).organization_id or r.created_by<>auth.uid() or r.invoice_id<>p_invoice or r.amount<>p_amount or r.method<>p_method then raise exception 'Collection request unavailable';end if;return;end if;
 select * into i from public.sales_invoices where id=p_invoice for update;
 if not found or i.customer_id is null or not public.farm_center_access(i.center_id) then raise exception 'Customer invoice unavailable';end if;
 if p_method not in ('cash','bank_transfer') or p_method is null then raise exception 'Choose Cash or Bank';end if;
 perform public._farm_receive_payment(p_invoice,p_amount,p_method,p_bank_account,p_reference);
 insert into public.farm_collection_requests(request_id,organization_id,invoice_id,created_by,amount,method) values(p_request,i.organization_id,i.id,auth.uid(),p_amount,p_method);
end $$;

-- Reject service products in every physical movement path, including RPC/import clients.
create function public.guard_service_product() returns trigger language plpgsql security definer set search_path=public as $$
declare p public.products;o public.sales_orders;begin
 select * into p from public.products where id=new.product_id;
 if p.product_type<>'service' then return new;end if;
 if tg_table_name<>'sales_order_lines' then raise exception 'Service items cannot enter inventory, purchases, lots or manufacturing';end if;
 select * into o from public.sales_orders where id=new.sales_order_id;
 if o.order_source<>'farm_services' or p.organization_id<>o.organization_id or new.location_id is not null or new.unit_cost<>0 then raise exception 'Service line requires a Farm Services bill and no inventory cost';end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'cogs_value') is distinct from (to_jsonb(old)-'cogs_value') then raise exception 'Confirmed service line is immutable';end if;
 return new;
end $$;
revoke all on function public.guard_service_product() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['sales_order_lines','purchase_order_lines','stock_movements','stock_transfer_lines','stock_scrap_lines','stock_adjustments','manufacturing_order_inputs','manufacturing_order_outputs','purchase_lots','purchase_lot_receipts','stock_sack_movements'] loop
 execute format('create trigger service_product_guard before insert or update on public.%I for each row execute function public.guard_service_product()',t);end loop;
end $$;
create function public.protect_product_type() returns trigger language plpgsql as $$
begin if new.product_type<>old.product_type then raise exception 'Stock/Service type cannot be converted; create a new product';end if;return new;end $$;
create trigger product_type_immutable before update on public.products for each row execute function public.protect_product_type();
revoke all on function public.protect_product_type() from public,anon,authenticated;

-- Extend existing cancellation; keep its conservative settled-credit/non-cash refund policy.
-- Exclude service lines from physical stock returns. No second financial reversal engine.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.review_bill_cancellation(uuid,boolean,text)'::regprocedure);
 d:=replace(d,'from public.sales_order_lines where sales_order_id=so.id','from public.sales_order_lines where sales_order_id=so.id and location_id is not null');
 d:=replace(d,'case when bill_type=''sale'' then ''sales'' else ''purchases'' end','case when bill_type=''sale'' then case when exists(select 1 from public.sales_orders s where s.id=bill_id and s.order_source=''farm_services'') then ''farm_services'' else ''sales'' end else ''purchases'' end');execute d;
 d:=pg_get_functiondef('public.request_bill_cancellation(text,uuid,text)'::regprocedure);
 d:=replace(d,'case when p_type=''sale'' then ''sales'' else ''purchases'' end','case when p_type=''sale'' then case when exists(select 1 from public.sales_orders s where s.id=p_bill and s.order_source=''farm_services'') then ''farm_services'' else ''sales'' end else ''purchases'' end');
 d:=replace(d,'if not public.sales_center_access(cid) then','if not (public.sales_center_access(cid) or (public.farm_center_access(cid) and exists(select 1 from public.sales_orders where id=p_bill and order_source=''farm_services''))) then');execute d;
end $$;
-- Farm administrators can review existing cancellation requests inside Farm Services.
create function public.review_farm_cancellation(p_request uuid,p_approve boolean,p_note text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.assert_business_operation('farm_services');
 if not public.is_admin() or not exists(select 1 from public.bill_cancel_requests r join public.sales_orders s on s.id=r.bill_id where r.id=p_request and r.bill_type='sale' and s.order_source='farm_services' and public.farm_center_access(s.center_id)) then raise exception 'Farm cancellation review denied';end if;
 perform public.review_bill_cancellation(p_request,p_approve,p_note);
end $$;
create policy farm_cancellation_read on public.bill_cancel_requests for select to authenticated using(bill_type='sale' and public.farm_center_access(center_id) and exists(select 1 from public.sales_orders where id=bill_id and order_source='farm_services'));
do $$ declare d text;begin
 d:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 d:=replace(d,E'\n case',E'\n if p_table=''bill_cancel_requests'' and p_row->>''bill_type''=''sale'' and exists(select 1 from public.sales_orders where id=(p_row->>''bill_id'')::uuid and order_source=''farm_services'') then return array[''farm_services'',''sales''];end if;\n case');execute d;
end $$;
revoke all on function public.save_farm_season(uuid,text,boolean,boolean),public.save_farm_service(uuid,text,text,text,numeric,boolean),public.create_farm_customer(uuid,text,text,text),public.confirm_farm_sale(uuid,uuid,jsonb),public.collect_farm_invoice(uuid,uuid,numeric,public.payment_method,uuid,text),public.review_farm_cancellation(uuid,boolean,text) from public,anon;
grant execute on function public.save_farm_season(uuid,text,boolean,boolean),public.save_farm_service(uuid,text,text,text,numeric,boolean),public.create_farm_customer(uuid,text,text,text),public.confirm_farm_sale(uuid,uuid,jsonb),public.collect_farm_invoice(uuid,uuid,numeric,public.payment_method,uuid,text),public.review_farm_cancellation(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
