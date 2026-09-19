create sequence if not exists public.purchase_order_number_seq start 1001;

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
  org_id uuid; po_id uuid; po_number text; item jsonb; product_id uuid; quality_id uuid;
  location_id uuid; quantity numeric; actual_price numeric; system_price numeric; total numeric;
begin
  if not public.can_access_center(target_center) then raise exception 'Access denied for this center'; end if;
  select organization_id into org_id from public.centers where id=target_center and is_active;
  if org_id is null or org_id<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
  if not exists(select 1 from public.suppliers where id=target_supplier and organization_id=org_id and is_active) then raise exception 'Invalid supplier'; end if;
  if jsonb_typeof(purchase_lines)<>'array' or jsonb_array_length(purchase_lines)=0 then raise exception 'At least one purchase line is required'; end if;
  po_number:='PO-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_order_number_seq')::text,5,'0');
  insert into public.purchase_orders(organization_id,center_id,supplier_id,po_number,payment_method,payment_reference,notes,created_by)
  values(org_id,target_center,target_supplier,po_number,selected_payment,nullif(trim(payment_ref),''),nullif(trim(purchase_notes),''),auth.uid()) returning id into po_id;
  for item in select * from jsonb_array_elements(purchase_lines) loop
    product_id:=(item->>'product_id')::uuid; quality_id:=(item->>'quality_id')::uuid;
    location_id:=nullif(item->>'location_id','')::uuid; quantity:=(item->>'quantity')::numeric; actual_price:=(item->>'actual_price')::numeric;
    if quantity<=0 then raise exception 'Every quantity must be greater than zero'; end if;
    if actual_price<0 then raise exception 'Purchase price cannot be negative'; end if;
    select coalesce(cp.price,q.default_price) into system_price from public.product_qualities q
      join public.products p on p.id=q.product_id left join public.center_prices cp on cp.center_id=target_center and cp.quality_id=q.id
      where q.id=quality_id and q.product_id=product_id and p.organization_id=org_id and p.is_active and q.is_active;
    if system_price is null then raise exception 'Invalid product or quality'; end if;
    insert into public.purchase_order_lines(purchase_order_id,product_id,quality_id,location_id,quantity,system_price,actual_price)
    values(po_id,product_id,quality_id,location_id,quantity,system_price,actual_price);
  end loop;
  perform public.confirm_purchase(po_id);
  select total_amount into total from public.purchase_orders where id=po_id;
  return query select po_id,po_number,total;
end $$;

grant usage,select on sequence public.purchase_order_number_seq to authenticated;
grant execute on function public.create_and_confirm_purchase(uuid,uuid,public.payment_method,text,text,jsonb) to authenticated;
