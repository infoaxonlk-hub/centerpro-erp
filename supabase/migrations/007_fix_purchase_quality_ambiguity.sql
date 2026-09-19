create or replace function public.create_and_confirm_purchase(
  target_center uuid,
  target_supplier uuid,
  selected_payment public.payment_method,
  payment_ref text,
  purchase_notes text,
  purchase_lines jsonb
)
returns table(purchase_id uuid, purchase_number text, purchase_total numeric)
language plpgsql security definer set search_path=public
as $$
declare
  v_org_id uuid;
  v_po_id uuid;
  v_po_number text;
  v_item jsonb;
  v_product_id uuid;
  v_quality_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_actual_price numeric;
  v_system_price numeric;
  v_total numeric;
begin
  if not public.can_access_center(target_center) then raise exception 'Access denied for this center'; end if;
  select c.organization_id into v_org_id from public.centers c where c.id=target_center and c.is_active;
  if v_org_id is null or v_org_id<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
  if not exists(select 1 from public.suppliers s where s.id=target_supplier and s.organization_id=v_org_id and s.is_active) then raise exception 'Invalid supplier'; end if;
  if jsonb_typeof(purchase_lines)<>'array' or jsonb_array_length(purchase_lines)=0 then raise exception 'At least one purchase line is required'; end if;

  v_po_number:='PO-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_order_number_seq')::text,5,'0');
  insert into public.purchase_orders(organization_id,center_id,supplier_id,po_number,payment_method,payment_reference,notes,created_by)
  values(v_org_id,target_center,target_supplier,v_po_number,selected_payment,nullif(trim(payment_ref),''),nullif(trim(purchase_notes),''),auth.uid())
  returning id into v_po_id;

  for v_item in select value from jsonb_array_elements(purchase_lines) loop
    v_product_id:=(v_item->>'product_id')::uuid;
    v_quality_id:=(v_item->>'quality_id')::uuid;
    v_location_id:=nullif(v_item->>'location_id','')::uuid;
    v_quantity:=(v_item->>'quantity')::numeric;
    v_actual_price:=(v_item->>'actual_price')::numeric;
    if v_quantity<=0 then raise exception 'Every quantity must be greater than zero'; end if;
    if v_actual_price<0 then raise exception 'Purchase price cannot be negative'; end if;

    select coalesce(cp.price,q.default_price) into v_system_price
    from public.product_qualities q
    join public.products p on p.id=q.product_id
    left join public.center_prices cp on cp.center_id=target_center and cp.quality_id=q.id
    where q.id=v_quality_id and q.product_id=v_product_id
      and p.organization_id=v_org_id and p.is_active and q.is_active;
    if v_system_price is null then raise exception 'Invalid product or quality'; end if;

    insert into public.purchase_order_lines(purchase_order_id,product_id,quality_id,location_id,quantity,system_price,actual_price)
    values(v_po_id,v_product_id,v_quality_id,v_location_id,v_quantity,v_system_price,v_actual_price);
  end loop;

  perform public.confirm_purchase(v_po_id);
  select po.total_amount into v_total from public.purchase_orders po where po.id=v_po_id;
  return query select v_po_id,v_po_number,v_total;
end $$;

grant execute on function public.create_and_confirm_purchase(uuid,uuid,public.payment_method,text,text,jsonb) to authenticated;
