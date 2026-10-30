begin;
-- Preserve existing sales, purchases AND manufacturing, including older RPC/import clients.
alter table public.products
 add column can_be_sold boolean not null default true,
 add column can_be_purchased boolean not null default true,
 add column can_be_manufactured boolean not null default true;

create function public.create_product_with_pricing(product_code text,product_name text,product_category_id uuid,product_unit text,global_price numeric,product_tracks_sacks boolean,product_tracks_purchase_lots boolean,product_default_sales_price numeric,product_costing_method text,product_can_be_sold boolean,product_can_be_purchased boolean,product_can_be_manufactured boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; begin
 result:=public.create_product_with_pricing(product_code,product_name,product_category_id,product_unit,global_price,product_tracks_sacks,product_tracks_purchase_lots,product_default_sales_price,product_costing_method);
 update public.products set can_be_sold=product_can_be_sold,can_be_purchased=product_can_be_purchased,can_be_manufactured=product_can_be_manufactured where id=result;
 return result;
end $$;
revoke all on function public.create_product_with_pricing(text,text,uuid,text,numeric,boolean,boolean,numeric,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.create_product_with_pricing(text,text,uuid,text,numeric,boolean,boolean,numeric,text,boolean,boolean,boolean) to authenticated;

create function public.edit_product_defaults(p_product uuid,p_code text,p_name text,p_category uuid,p_unit text,p_sacks boolean,p_lots boolean,p_sales numeric,p_method text,p_prices jsonb,p_sold boolean,p_purchased boolean,p_manufactured boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.edit_product_defaults(p_product,p_code,p_name,p_category,p_unit,p_sacks,p_lots,p_sales,p_method,p_prices);
 update public.products set can_be_sold=p_sold,can_be_purchased=p_purchased,can_be_manufactured=p_manufactured where id=p_product;
end $$;
revoke all on function public.edit_product_defaults(uuid,text,text,uuid,text,boolean,boolean,numeric,text,jsonb,boolean,boolean,boolean) from public,anon;
grant execute on function public.edit_product_defaults(uuid,text,text,uuid,text,boolean,boolean,numeric,text,jsonb,boolean,boolean,boolean) to authenticated;

-- Apply at the tables used by online/offline/legacy RPCs; do not depend on UI filters.
-- Parent row locking serializes concurrent duplicate inserts into the same purchase.
create function public.guard_product_process_line() returns trigger language plpgsql security definer set search_path=public as $$
declare product public.products; org uuid; parent_status text;
begin
 select * into product from public.products where id=new.product_id for share;
 if not found then raise exception 'Product not found';end if;
 if tg_table_name='purchase_order_lines' then
  select organization_id,status into org,parent_status from public.purchase_orders where id=new.purchase_order_id for update;
 elsif tg_table_name='sales_order_lines' then
  select organization_id,status into org,parent_status from public.sales_orders where id=new.sales_order_id;
 else
  select organization_id,status into org,parent_status from public.manufacturing_orders where id=new.order_id for update;
 end if;
 if org is null or org<>product.organization_id or org<>(public.current_profile()).organization_id then raise exception 'Product belongs to another business';end if;
 -- Historical receipts remain immutable/returnable even after a process flag changes.
 if tg_op='UPDATE' and parent_status in ('confirmed','cancelled','completed') then return new;end if;
 if not product.is_active then raise exception 'Product is inactive';end if;
 if tg_table_name='purchase_order_lines' then
  if tg_op='INSERT' and parent_status<>'draft' then raise exception 'Confirmed purchase lines cannot be added';end if;
  if not product.can_be_purchased then raise exception 'Product cannot be purchased';end if;
  if exists(select 1 from public.purchase_order_lines l where l.purchase_order_id=new.purchase_order_id and l.product_id=new.product_id and l.id<>new.id) then
   raise exception 'Only one lot and total weighing per product is allowed in a purchase order';
  end if;
 elsif tg_table_name='sales_order_lines' then
  if not product.can_be_sold then raise exception 'Product cannot be sold';end if;
 elsif tg_table_name='manufacturing_order_outputs' then
  if not product.can_be_manufactured then raise exception 'Product cannot be manufactured';end if;
 elsif not (product.can_be_purchased or product.can_be_manufactured) then
  raise exception 'Manufacturing inputs must be purchasable or manufacturable';
 end if;
 return new;
end $$;
revoke all on function public.guard_product_process_line() from public,anon,authenticated;
create trigger product_process_guard before insert or update on public.purchase_order_lines for each row execute function public.guard_product_process_line();
create trigger product_process_guard before insert or update on public.sales_order_lines for each row execute function public.guard_product_process_line();
create trigger product_process_guard before insert or update on public.manufacturing_order_inputs for each row execute function public.guard_product_process_line();
create trigger product_process_guard before insert or update on public.manufacturing_order_outputs for each row execute function public.guard_product_process_line();

-- Recheck flags when an existing draft is confirmed, even if lines were saved earlier.
create function public.guard_product_process_confirmation() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='purchase_orders' and old.status::text='draft' and new.status::text='confirmed' then
  perform 1 from public.products p join public.purchase_order_lines l on l.product_id=p.id where l.purchase_order_id=new.id order by p.id for share of p;
  if exists(select 1 from public.purchase_order_lines l join public.products p on p.id=l.product_id where l.purchase_order_id=new.id and (not p.can_be_purchased or not p.is_active or p.organization_id<>new.organization_id)) then raise exception 'Product cannot be purchased';end if;
  if exists(select 1 from public.purchase_order_lines where purchase_order_id=new.id group by product_id having count(*)>1) then raise exception 'Only one lot and total weighing per product is allowed in a purchase order';end if;
 elsif tg_table_name='sales_orders' and old.status::text is distinct from new.status::text and new.status::text='confirmed' then
  perform 1 from public.products p join public.sales_order_lines l on l.product_id=p.id where l.sales_order_id=new.id order by p.id for share of p;
  if exists(select 1 from public.sales_order_lines l join public.products p on p.id=l.product_id where l.sales_order_id=new.id and (not p.can_be_sold or not p.is_active or p.organization_id<>new.organization_id)) then raise exception 'Product cannot be sold';end if;
 elsif tg_table_name='manufacturing_orders' and old.status::text='draft' and new.status::text='completed' then
  perform 1 from public.products p where p.id in (select product_id from public.manufacturing_order_inputs where order_id=new.id union select product_id from public.manufacturing_order_outputs where order_id=new.id) order by p.id for share;
  if exists(select 1 from public.manufacturing_order_inputs l join public.products p on p.id=l.product_id where l.order_id=new.id and not (p.can_be_purchased or p.can_be_manufactured)) then raise exception 'Manufacturing inputs must be purchasable or manufacturable';end if;
  if exists(select 1 from public.manufacturing_order_outputs l join public.products p on p.id=l.product_id where l.order_id=new.id and not p.can_be_manufactured) then raise exception 'Product cannot be manufactured';end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_product_process_confirmation() from public,anon,authenticated;
create trigger product_process_confirmation before update of status on public.purchase_orders for each row execute function public.guard_product_process_confirmation();
create trigger product_process_confirmation before update of status on public.sales_orders for each row execute function public.guard_product_process_confirmation();
create trigger product_process_confirmation before update of status on public.manufacturing_orders for each row execute function public.guard_product_process_confirmation();
-- Existing confirmed multi-row receipts are deliberately retained; old split drafts must be edited.
notify pgrst,'reload schema';
commit;
