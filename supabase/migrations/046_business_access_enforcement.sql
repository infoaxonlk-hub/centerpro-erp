begin;
-- Existing 044 tenant policies and tenant_write_guard triggers remain unchanged.
create function public.business_table_modules(p_table text,p_row jsonb default '{}'::jsonb,p_write boolean default false)
returns text[] language plpgsql stable security definer set search_path=public as $$
begin
 case
 when p_table in ('centers','locations') then
   return case when p_write then array['centers'] else array['dashboard'] end;
 when p_table='user_center_access' then
   return case when p_write then array['users'] else array['dashboard'] end;
 when p_table in ('products','product_qualities','product_categories') then
   return case when p_write then array['masters'] else array['masters','sales','purchases','inventory','stock_adjustments'] end;
 when p_table in ('center_prices') then return case when p_write then array['masters'] else array['masters','purchases'] end;
 when p_table='suppliers' then return array['purchases','masters','supplier_payables'];
 when p_table='purchase_orders' then return case when p_write then array['purchases'] else array['purchases','payment_reports','supplier_payables'] end;
 when p_table in ('purchase_order_lines','offline_purchase_requests') then return array['purchases'];
 when p_table in ('sales_orders','sales_order_lines','customers','sales_prices') then return array['sales'];
 when p_table in ('sales_invoices','customer_receivables','sales_credit_settlements') then return array['sales','customer_receivables'];
 when p_table='sales_payments' then return array['sales','customer_receivables','payment_reports'];
 when p_table in ('supplier_payables','purchase_credit_settlements') then return array['purchases','supplier_payables'];
 when p_table='payments' then return array['purchases','payment_reports','cheques','supplier_payables'];
 when p_table='stock_movements' then return array['inventory'];
 when p_table in ('stock_transfers','stock_transfer_lines') then return array['stock_transfers'];
 when p_table in ('stock_scraps','stock_scrap_lines') then return array['inventory'];
 when p_table='stock_adjustments' then return array['stock_adjustments'];
 when p_table in ('laborers','labor_sessions','labor_session_workers','labor_payments') then return array['labor'];
 when p_table in ('cash_ledger','cash_handovers','center_cash_topups','admin_cash_in','center_cash_issues',
   'cash_accounts','cash_account_entries') then return array['cash'];
 when p_table in ('expenses','expense_categories','expense_cash_ledger','expense_cash_handovers') then return array['expenses'];
 when p_table in ('bank_accounts','payment_banks') then
   return case when p_write then array['bank'] else array['bank','cash','purchases','sales','expenses','payment_reports','cheques'] end;
 when p_table in ('bank_book_entries','bank_fundings','bank_book_contra_entries') then return array['bank'];
 when p_table='audit_logs' then return array['audit'];
 when p_table='notifications' then
   return case when p_row->>'type' like '%price%' or p_row->>'type' like '%purchase%' then array['purchases']
    when p_row->>'type' like '%sale%' then array['sales']
    when p_row->>'type' like '%expense%' then array['expenses']
    when p_row->>'type' like '%cash%' then array['cash'] else array['dashboard'] end;
 when p_table in ('bill_cancel_requests','bill_returns') then
   return case when p_row->>'bill_type'='sale' then array['sales'] else array['purchases'] end;
 when p_table='bill_return_lines' then
   return (select case when r.bill_type='sale' then array['sales'] else array['purchases'] end
    from public.bill_returns r where r.id=(p_row->>'return_id')::uuid);
 else return '{}'::text[];
 end case;
end $$;
revoke all on function public.business_table_modules(text,jsonb,boolean) from public,anon,authenticated;

create function public.business_table_access(p_table text,p_row jsonb default '{}'::jsonb,p_write boolean default false)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select p.is_active and public.business_operational(p.organization_id)
 and ((p_table in ('stock_scraps','stock_scrap_lines') and p.role='center_user' and public.business_module_enabled(p.organization_id,'inventory'))
 or exists(select 1 from unnest(public.business_table_modules(p_table,p_row,p_write)) m
 where public.business_module_enabled(p.organization_id,m) and public.business_module_user_allowed(m)))
 from public.profiles p where p.id=auth.uid()),false)
$$;
revoke all on function public.business_table_access(text,jsonb,boolean) from public,anon;
grant execute on function public.business_table_access(text,jsonb,boolean) to authenticated;

-- Add a business/subscription/module boundary to all operational tables, including children.
do $$
declare t record;
begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname not in
 ('organizations','profiles','business_module_catalog','business_subscriptions','business_module_entitlements','business_subscription_history')
 loop
   execute format('create policy business_operation_boundary on public.%I as restrictive for all to authenticated using
    (public.business_table_access(%L,to_jsonb(%I),false)) with check (public.business_table_access(%L,to_jsonb(%I),true))',
    t.relname,t.relname,t.relname,t.relname,t.relname);
   execute format('create policy business_delete_boundary on public.%I as restrictive for delete to authenticated using
    (public.business_table_access(%L,to_jsonb(%I),true))',t.relname,t.relname,t.relname);
 end loop;
end $$;

-- A restricted account may still read its own login profile, not its staff directory.
create policy profile_account_boundary on public.profiles as restrictive for select to authenticated
 using(id=auth.uid() or public.business_table_access('centers','{}'::jsonb,false));

-- Revalidate business state for every write, even inside SECURITY DEFINER functions.
-- Module checks on RPC entrypoints below allow normal accounting/stock side effects
-- without granting direct writes to a disabled standalone finance/inventory module.
create function public.enforce_business_operation() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null then
   perform public.assert_business_operation(null);
   if TG_OP<>'DELETE' and to_jsonb(new)->>'labor_session_id' is not null then
     perform public.assert_business_operation('labor');
   end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.enforce_business_operation() from public,anon,authenticated;
do $$
declare t record;
begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname not in
 ('organizations','profiles','business_module_catalog','business_subscriptions','business_module_entitlements','business_subscription_history')
 loop
   execute format('create trigger business_operation_guard before insert or update or delete on public.%I
   for each row execute function public.enforce_business_operation()',t.relname);
 end loop;
end $$;
create function public.protect_business_configuration() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null then
   if TG_TABLE_NAME='organizations' then
     if new.business_status is distinct from old.business_status then
       raise exception 'Business configuration requires platform management service' using errcode='42501';
     end if;
   else raise exception 'Business configuration requires platform management service' using errcode='42501';
   end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger business_status_guard before update on public.organizations
 for each row execute function public.protect_business_configuration();
create trigger business_subscription_guard before insert or update or delete on public.business_subscriptions
 for each row execute function public.protect_business_configuration();
create trigger business_entitlement_guard before insert or update or delete on public.business_module_entitlements
 for each row execute function public.protect_business_configuration();
revoke all on function public.protect_business_configuration() from public,anon,authenticated;

-- Business-aware existing helpers retain existing role/permission semantics.
create or replace function public.has_permission(required_permission text)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select p.is_active and public.business_operational(p.organization_id)
 and (p.role='super_admin' or required_permission=any(p.permissions))
 from public.profiles p where p.id=auth.uid()),false)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select p.role in ('super_admin','admin') and p.is_active
 and public.business_operational(p.organization_id) from public.profiles p where p.id=auth.uid()),false)
$$;
create or replace function public.can_access_center(target_center uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles p join public.centers c on c.organization_id=p.organization_id
 where p.id=auth.uid() and p.is_active and public.business_operational(p.organization_id) and c.id=target_center
 and (p.role in ('super_admin','admin') or exists(select 1 from public.user_center_access a where a.user_id=p.id and a.center_id=c.id)))
$$;

create function public.assert_business_finance_access() returns void
language plpgsql stable security definer set search_path=public as $$
declare org uuid;
begin
 perform public.assert_business_operation(null);
 org:=(public.current_profile()).organization_id;
 if not exists(select 1 from unnest(array['cash','purchases','sales','expenses','labor','bank']) m
 where public.business_module_enabled(org,m) and public.business_module_user_allowed(m)) then
 raise exception 'Financial access denied' using errcode='42501'; end if;
end $$;
revoke all on function public.assert_business_finance_access() from public,anon,authenticated;

-- Labor wages use the same proven expense posting implementation internally.
-- Its private clone is not callable by business users and does not grant Expenses
-- permission to a labor-only user; only the guarded labor RPC may invoke it.
do $$
declare r record; definition text;
begin
 select p.oid,p.proname into r from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='create_center_expense';
 definition:=replace(pg_get_functiondef(r.oid),'FUNCTION public.create_center_expense(','FUNCTION public._labor_post_expense(');
 execute definition;
 execute 'revoke all on function public._labor_post_expense(uuid,uuid,date,text,numeric,public.payment_method,text,uuid,text,date,text) from public,anon,authenticated';
 for r in select p.oid,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='pay_labor_session_worker' loop
 execute replace(pg_get_functiondef(r.oid),'public.create_center_expense(','public._labor_post_expense(');
 end loop;
end $$;

-- Preserve the pre-existing delegated center-user Scrap capability, without
-- granting Stock explorer access or direct stock-movement reads to those users.
create function public.assert_business_scrap_access() returns void
language plpgsql stable security definer set search_path=public as $$
declare p public.profiles;
begin
 perform public.assert_business_operation(null);
 p:=public.current_profile();
 if not public.business_module_enabled(p.organization_id,'inventory') or not
 (p.role='center_user' or p.role='super_admin' or public.has_permission('stock')) then
 raise exception 'Stock scrap access denied' using errcode='42501'; end if;
end $$;
revoke all on function public.assert_business_scrap_access() from public,anon,authenticated;

create function public.stock_scrap_balances() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare org uuid; result jsonb;
begin
 perform public.assert_business_scrap_access();
 org:=(public.current_profile()).organization_id;
 select coalesce(jsonb_agg(jsonb_build_object(
 'key',g.center_id::text||':'||g.location_id::text||':'||g.product_id::text||':'||g.quality_id::text,
 'centerId',g.center_id,'locationId',g.location_id,'productId',g.product_id,'qualityId',g.quality_id,
 'centerLabel',g.center_label,'locationLabel',g.location_label,'productCode',g.product_code,
 'productName',g.product_name,'qualityName',g.quality_name,'unit',g.unit,'quantity',g.quantity,'value',g.value)
 order by g.product_name,g.quality_name),'[]'::jsonb) into result
 from (
 select s.center_id,s.location_id,s.product_id,s.quality_id,c.code||' · '||c.name center_label,
 l.code||' · '||l.name location_label,p.code product_code,p.name product_name,q.name quality_name,p.unit_of_measure unit,
 sum(case when s.movement_type in ('purchase_in','transfer_in','adjustment_in') then s.quantity else -s.quantity end) quantity,
 sum(case when s.movement_type in ('purchase_in','transfer_in','adjustment_in') then s.quantity*s.unit_cost else -s.quantity*s.unit_cost end) value
 from public.stock_movements s join public.centers c on c.id=s.center_id and c.organization_id=org
 join public.locations l on l.id=s.location_id and l.center_id=c.id
 join public.products p on p.id=s.product_id and p.organization_id=org
 join public.product_qualities q on q.id=s.quality_id and q.product_id=p.id
 where s.organization_id=org and public.can_access_center(s.center_id)
 group by s.center_id,s.location_id,s.product_id,s.quality_id,c.code,c.name,l.code,l.name,p.code,p.name,q.name,p.unit_of_measure
 having sum(case when s.movement_type in ('purchase_in','transfer_in','adjustment_in') then s.quantity else -s.quantity end)>0.0001
 ) g;
 return result;
end $$;
revoke all on function public.stock_scrap_balances() from public,anon;
grant execute on function public.stock_scrap_balances() to authenticated;

-- Guard the current installed overloads in-place, retaining OIDs, ACLs, defaults,
-- signatures, existing transaction logic and dependent trigger/policy references.
-- Migration fails rather than silently leaving an expected entrypoint unguarded.
do $$
declare r record; mapping jsonb := '{
 "create_center_with_default_location":"centers",
 "create_product_with_pricing":"masters","import_products":"masters",
 "create_and_confirm_purchase":"purchases","create_and_confirm_purchase_split":"purchases",
 "confirm_purchase":"purchases","confirm_queued_purchase":"purchases",
 "confirm_queued_purchase_detailed":"purchases","confirm_queued_purchase_with_labor":"purchases",
 "create_sales_customer":"sales","set_sales_price":"sales","sales_stock":"sales",
 "confirm_center_sale":"sales","confirm_center_sale_with_labor":"sales",
 "receive_invoice_payment":"customer_receivables","pay_supplier_credit":"supplier_payables",
 "create_stock_transfer":"stock_transfers","create_stock_adjustment":"stock_adjustments","create_stock_scrap":"@scrap",
 "pay_labor_session_worker":"labor","create_center_expense":"expenses",
 "record_admin_cash_in":"cash","issue_combined_center_cash":"cash","receive_combined_center_cash":"cash",
 "receive_center_cash_with_note":"cash","issue_center_cash":"cash","issue_center_expense_cash":"expenses",
 "respond_cash_handover":"cash","respond_expense_cash_handover":"expenses",
 "request_center_cash_topup":"cash","review_center_cash_topup":"cash","cash_float_available":"cash",
 "update_cheque_status":"cheques","update_cheque_reminder_days":"cheques",
 "record_admin_bank_funding":"bank","company_bank_statement":"bank","bank_book_balance":"bank",
 "center_cash_general_ledger":"cash",
 "update_company_profile":"users","update_organization_receipt_name":"users",
 "request_bill_cancellation":"@bill","review_bill_cancellation":"@cancel",
 "request_bill_return":"@bill","review_bill_return":"@return",
 "cash_account_balance":"@shared","center_cash_balance":"@shared"
 }'::jsonb; source text; definition text; statement text; module_key text;
begin
 for r in select p.oid,p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 join pg_language l on l.oid=p.prolang where n.nspname='public' and l.lanname='plpgsql'
 and mapping ? p.proname
 loop
   module_key:=mapping->>r.proname;
   if module_key='@scrap' then
     statement:='perform public.assert_business_scrap_access();';
   elsif module_key='@bill' then
     statement:='perform public.assert_business_operation(case when p_type=''sale'' then ''sales'' else ''purchases'' end);';
   elsif module_key='@cancel' then
     statement:='perform public.assert_business_operation((select case when bill_type=''sale'' then ''sales'' else ''purchases'' end from public.bill_cancel_requests where id=p_request));';
   elsif module_key='@return' then
     statement:='perform public.assert_business_operation((select case when bill_type=''sale'' then ''sales'' else ''purchases'' end from public.bill_returns where id=p_return));';
   elsif module_key='@shared' then
     statement:='perform public.assert_business_finance_access();';
   else statement:=format('perform public.assert_business_operation(%L);',module_key);
   end if;
   source:=regexp_replace(r.prosrc,'(^|\n)([ \t]*[Bb][Ee][Gg][Ii][Nn])[[:space:]]+',E'\\1\\2\n '||statement||E'\n');
   -- 030 inserted a header with the default quantity 0 although its CHECK is >0.
   -- Seed the real requested total; the existing line validation and final totals
   -- still execute atomically and roll back invalid/insufficient-stock requests.
   if r.proname='create_stock_scrap' then
     source:=replace(source,'location_label,reason,created_by)','location_label,reason,created_by,total_quantity)');
     source:=replace(source,'trim(p_reason),auth.uid()) returning id into scrap_id',
       'trim(p_reason),auth.uid(),(select sum((x->>''quantity'')::numeric) from jsonb_array_elements(p_lines) x)) returning id into scrap_id');
   end if;
   if source=r.prosrc then raise exception 'Could not guard RPC %',r.proname; end if;
   definition:=pg_get_functiondef(r.oid);
   execute replace(definition,r.prosrc,source);
 end loop;
end $$;
-- Labor can inspect linked weights/load counts without gaining bill/finance access.
create function public.labor_linked_orders() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare org uuid;
begin
 perform public.assert_business_operation('labor');
 org:=(public.current_profile()).organization_id;
 return jsonb_build_object(
 'purchases',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'labor_session_id',p.labor_session_id,'labor_load_count',p.labor_load_count,
 'purchase_order_lines',(select coalesce(jsonb_agg(jsonb_build_object('quantity',l.quantity,'sack_count',l.sack_count)),'[]'::jsonb) from public.purchase_order_lines l where l.purchase_order_id=p.id)))
 from public.purchase_orders p where p.organization_id=org and p.labor_session_id is not null and public.can_access_center(p.center_id)),'[]'::jsonb),
 'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'labor_session_id',s.labor_session_id,'labor_load_count',s.labor_load_count,
 'sales_order_lines',(select coalesce(jsonb_agg(jsonb_build_object('quantity',l.quantity,'unit',l.unit)),'[]'::jsonb) from public.sales_order_lines l where l.sales_order_id=s.id)))
 from public.sales_orders s where s.organization_id=org and s.labor_session_id is not null and public.can_access_center(s.center_id)),'[]'::jsonb));
end $$;
revoke all on function public.labor_linked_orders() from public,anon;
grant execute on function public.labor_linked_orders() to authenticated;

-- A SQL helper delegates to the guarded center cash balance.
-- Internal posting functions already had execute privileges revoked by 039/044.
create policy business_product_images_boundary on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'product-images' or public.business_table_access('products','{}'::jsonb,false))
 with check(bucket_id<>'product-images' or public.business_table_access('products','{}'::jsonb,true));
commit;
