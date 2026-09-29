begin;

-- Separate stock adjustment permission from read-only stock access.
 drop policy if exists stock_adjustments_read on public.stock_adjustments;
 create policy stock_adjustments_read on public.stock_adjustments for select using (
  organization_id=(public.current_profile()).organization_id
  and public.has_permission('stock_adjustment') and public.can_access_center(center_id)
 );

-- A center user can maintain product records only when an administrator grants that action.
 create policy "permitted users create products" on public.products for insert with check (
  organization_id=(public.current_profile()).organization_id
  and public.has_permission('masters') and public.has_permission('product_create')
 );
 create policy "permitted users edit products" on public.products for update using (
  organization_id=(public.current_profile()).organization_id
  and public.has_permission('masters') and public.has_permission('product_edit')
 ) with check (
  organization_id=(public.current_profile()).organization_id
  and public.has_permission('masters') and public.has_permission('product_edit')
  and (category_id is null or exists(select 1 from public.product_categories c where c.id=category_id and c.organization_id=(public.current_profile()).organization_id))
 );

create or replace function public.create_product_with_pricing(
  product_code text,
  product_name text,
  product_category_id uuid,
  product_unit text,
  global_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org_id uuid;
  new_product_id uuid;
begin
  if not public.is_admin() and (not public.has_permission('masters') or not public.has_permission('product_create')) then raise exception 'Product creation access required'; end if;
  if global_price is null or global_price < 0 then raise exception 'Global price must be zero or greater'; end if;

  select organization_id into org_id from public.profiles where id = auth.uid();
  if product_category_id is not null and not exists (
    select 1 from public.product_categories where id=product_category_id and organization_id=org_id and is_active
  ) then raise exception 'Invalid product category'; end if;

  insert into public.products(organization_id, code, name, category, category_id, unit_of_measure)
  select org_id, upper(trim(product_code)), trim(product_name), c.name, c.id, product_unit
  from (select product_category_id id) x
  left join public.product_categories c on c.id=x.id
  returning id into new_product_id;

  insert into public.product_qualities(product_id, name, description, default_price, is_base)
  values(new_product_id, 'Standard', 'Base product price', global_price, true);

  return new_product_id;
end;
$$;



create or replace function public.create_stock_adjustment(
 p_request uuid,p_center uuid,p_location uuid,p_product uuid,p_quality uuid,
 p_counted numeric,p_unit_cost numeric,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 actor public.profiles%rowtype;
 adjustment_id uuid;
 org_id uuid;
 available numeric;
 stock_value numeric;
 delta numeric;
 cost numeric;
begin
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if not found or not public.has_permission('stock') or not public.has_permission('stock_adjustment') then raise exception 'Stock adjustment permission required'; end if;
 if p_request is null then raise exception 'Request ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select id into adjustment_id from public.stock_adjustments where request_id=p_request and created_by=auth.uid();
 if adjustment_id is not null then return adjustment_id; end if;
 if p_center is null or p_location is null or p_product is null or p_quality is null then raise exception 'Select center, location, product and quality'; end if;
 if not public.can_access_center(p_center) then raise exception 'Center access denied'; end if;
 if p_counted is null or p_counted<0 or p_counted<>round(p_counted,3) then raise exception 'Counted quantity must be nonnegative with at most 3 decimals'; end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Enter a reason (3 to 500 characters)'; end if;
 -- Serialize every stock writer that follows the existing center row locking convention.
 perform 1 from public.centers where id=p_center for update;
 select c.organization_id into org_id
 from public.centers c join public.locations l on l.center_id=c.id
 join public.products p on p.organization_id=c.organization_id
 join public.product_qualities q on q.product_id=p.id
 where c.id=p_center and l.id=p_location and p.id=p_product and q.id=p_quality
 and c.is_active and l.is_active and p.is_active and q.is_active;
 if org_id is null or org_id<>actor.organization_id then raise exception 'Selected stock item is unavailable'; end if;
 select coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity else -quantity end),0),
 coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity*unit_cost else -quantity*unit_cost end),0)
 into available,stock_value from public.stock_movements
 where center_id=p_center and location_id=p_location and product_id=p_product and quality_id=p_quality;
 delta:=p_counted-available;
 if delta=0 then raise exception 'Counted quantity matches system stock; no adjustment needed'; end if;
 if available<0 then raise exception 'Negative system balance must be investigated before adjustment'; end if;
 if available>0 then cost:=greatest(0,round(stock_value/available,2));
 else
  if delta>0 and (p_unit_cost is null or p_unit_cost<0 or p_unit_cost<>round(p_unit_cost,2)) then raise exception 'Enter a valid unit cost for stock added from zero'; end if;
  cost:=coalesce(p_unit_cost,0);
 end if;
 insert into public.stock_adjustments(request_id,organization_id,center_id,location_id,product_id,quality_id,previous_quantity,counted_quantity,difference,unit_cost,reason,created_by)
 values(p_request,org_id,p_center,p_location,p_product,p_quality,available,p_counted,delta,cost,trim(p_reason),auth.uid()) returning id into adjustment_id;
 insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
 values(org_id,p_center,p_location,p_product,p_quality,case when delta>0 then 'adjustment_in'::public.stock_movement_type else 'adjustment_out'::public.stock_movement_type end,
 abs(delta),cost,'stock_adjustment',adjustment_id,auth.uid());
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
 values(org_id,auth.uid(),'stock_adjusted','stock_adjustment',adjustment_id::text,
 jsonb_build_object('center_id',p_center,'location_id',p_location,'product_id',p_product,'quality_id',p_quality,'before',available,'counted',p_counted,'difference',delta,'unit_cost',cost,'reason',trim(p_reason)));
 return adjustment_id;
end $$;

commit;
