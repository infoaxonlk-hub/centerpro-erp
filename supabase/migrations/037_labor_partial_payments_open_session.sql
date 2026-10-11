-- Allow labor payouts before session close. Amounts remain capped at the live earned balance.
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
  -- Open sessions may receive partial payments; the current work total still caps payouts below.
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
