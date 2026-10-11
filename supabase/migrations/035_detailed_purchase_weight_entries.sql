-- Detailed purchase rows keep their individual kg and sack counts while the
-- existing purchase/payment RPC continues to post stock and payment normally.
alter table public.purchase_order_lines
  add column if not exists sack_count integer not null default 0 check (sack_count >= 0),
  add column if not exists entry_order bigint generated always as identity;

create or replace function public.confirm_queued_purchase_detailed(
  p_request uuid,
  target_center uuid,
  target_supplier uuid,
  purchase_notes text,
  purchase_lines jsonb,
  payment_allocations jsonb,
  purchase_sack_counts jsonb,
  use_cash_farmer boolean default false
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
declare
  v_supplier uuid := target_supplier;
  v_organization uuid;
  v_result record;
  v_line_count integer;
  v_sack_count integer;
begin
  if use_cash_farmer and v_supplier is null then
    if not public.can_access_center(target_center) then raise exception 'Access denied for this center'; end if;
    select organization_id into v_organization from public.centers where id=target_center and is_active;
    if v_organization is null or v_organization<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_organization::text||':cash-farmer',0));
    select id into v_supplier from public.suppliers
      where organization_id=v_organization and lower(trim(name))='cash farmer' and is_active
      order by created_at,id limit 1;
    if v_supplier is null then
      insert into public.suppliers(organization_id,name,is_active)
      values(v_organization,'Cash Farmer',true) returning id into v_supplier;
    end if;
  end if;

  if coalesce(jsonb_typeof(purchase_sack_counts),'null')<>'array' or jsonb_array_length(purchase_sack_counts)=0 then
    raise exception 'Weight rows are required for a detailed purchase';
  end if;
  if exists(
    select 1 from jsonb_array_elements(purchase_sack_counts) as e(value)
    where coalesce(value->>'sack_count','') !~ '^\d+$'
       or (value->>'sack_count')::integer <= 0
  ) then raise exception 'Every detailed purchase row needs a whole sack count greater than zero'; end if;

  select * into v_result from public.confirm_queued_purchase(
    p_request,target_center,v_supplier,purchase_notes,purchase_lines,payment_allocations
  );
  select count(*) into v_line_count from public.purchase_order_lines where purchase_order_lines.purchase_order_id=v_result.purchase_id;
  select jsonb_array_length(purchase_sack_counts) into v_sack_count;
  if v_line_count<>v_sack_count then raise exception 'Weight rows do not match the purchase lines'; end if;

  with requested as (
    select ordinality::bigint as row_no, (value->>'sack_count')::integer as sack_count
    from jsonb_array_elements(purchase_sack_counts) with ordinality
  ), posted as (
    select id,row_number() over(order by entry_order) as row_no
    from public.purchase_order_lines where purchase_order_lines.purchase_order_id=v_result.purchase_id
  )
  update public.purchase_order_lines l set sack_count=requested.sack_count
  from posted join requested using(row_no)
  where l.id=posted.id;

  return query select v_result.purchase_id,v_result.purchase_number,v_result.purchase_total,
    v_result.paid_amount,v_result.credit_balance,v_result.payment_status;
end;
$$;

revoke all on function public.confirm_queued_purchase_detailed(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,boolean) from public;
grant execute on function public.confirm_queued_purchase_detailed(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,boolean) to authenticated;
