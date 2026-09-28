-- Make an offline purchase sync safe to retry when the browser loses the
-- response after the database has already committed the purchase.
create table public.offline_purchase_requests (
  request_id uuid primary key,
  created_by uuid not null references auth.users(id),
  center_id uuid not null references public.centers(id),
  purchase_id uuid not null unique references public.purchase_orders(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.offline_purchase_requests enable row level security;
revoke all on public.offline_purchase_requests from anon, authenticated;

create or replace function public.confirm_queued_purchase(
  p_request uuid,
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
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_existing_center uuid;
  v_existing_purchase uuid;
  v_purchase_id uuid;
  v_purchase_number text;
  v_purchase_total numeric;
  v_paid_amount numeric;
  v_credit_balance numeric;
  v_payment_status text;
begin
  if v_actor is null or p_request is null then
    raise exception 'Authenticated user and request ID are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request::text, 0));
  select r.center_id, r.purchase_id into v_existing_center, v_existing_purchase
  from public.offline_purchase_requests r
  where r.request_id = p_request and r.created_by = v_actor;

  if v_existing_purchase is not null then
    if v_existing_center <> target_center then raise exception 'Request ID is already used for a different center'; end if;
    select po.id, po.po_number, po.total_amount, po.paid_amount, po.credit_balance, po.payment_status
      into v_purchase_id, v_purchase_number, v_purchase_total, v_paid_amount, v_credit_balance, v_payment_status
    from public.purchase_orders po where po.id = v_existing_purchase;
    return query select v_purchase_id, v_purchase_number, v_purchase_total, v_paid_amount, v_credit_balance, v_payment_status;
    return;
  end if;

  select p.purchase_id, p.purchase_number, p.purchase_total, p.paid_amount, p.credit_balance, p.payment_status
    into v_purchase_id, v_purchase_number, v_purchase_total, v_paid_amount, v_credit_balance, v_payment_status
  from public.create_and_confirm_purchase_split(target_center, target_supplier, purchase_notes, purchase_lines, payment_allocations) p;

  insert into public.offline_purchase_requests(request_id, created_by, center_id, purchase_id)
  values (p_request, v_actor, target_center, v_purchase_id);

  return query select v_purchase_id, v_purchase_number, v_purchase_total, v_paid_amount, v_credit_balance, v_payment_status;
end;
$$;

revoke all on function public.confirm_queued_purchase(uuid, uuid, uuid, text, jsonb, jsonb) from public;
grant execute on function public.confirm_queued_purchase(uuid, uuid, uuid, text, jsonb, jsonb) to authenticated;
