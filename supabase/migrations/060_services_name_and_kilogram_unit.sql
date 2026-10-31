-- Keep module/permission keys, routes and existing billed units unchanged.
-- Extend service units without enabling inventory tracking for service items.
begin;
update public.business_module_catalog set name='Services' where key='farm_services';
alter table public.products drop constraint service_product_settings;
alter table public.products add constraint service_product_settings check(product_type='stock' or
 (unit_of_measure in ('Acre','Hour','KG') and can_be_sold and not can_be_purchased and not can_be_manufactured and not tracks_sacks and not tracks_purchase_lots and default_sales_price is not null));
create or replace function public.save_farm_service(p_id uuid,p_code text,p_name text,p_unit text,p_rate numeric,p_active boolean default true) returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid;result uuid;begin
 perform public.assert_business_operation('farm_services');org:=(public.current_profile()).organization_id;
 if not (public.is_admin() or public.has_permission('farm_services_manage')) then raise exception 'Service management permission required';end if;
 perform public.farm_number(p_rate::text,2,true);
 if p_unit not in ('Acre','Hour','KG') or p_unit is null or length(trim(coalesce(p_name,''))) not between 1 and 200 or length(trim(coalesce(p_code,''))) not between 1 and 60 then raise exception 'Service code, name and Acre/Hour/KG unit required';end if;
 if p_id is null then
 insert into public.products(organization_id,code,name,unit_of_measure,product_type,default_sales_price,can_be_sold,can_be_purchased,can_be_manufactured,tracks_sacks,tracks_purchase_lots,is_active)
 values(org,trim(p_code),trim(p_name),p_unit,'service',p_rate,true,false,false,false,false,p_active) returning id into result;
 insert into public.product_qualities(product_id,name,default_price,is_base) values(result,'Standard',0,true);
 else update public.products set code=trim(p_code),name=trim(p_name),unit_of_measure=p_unit,default_sales_price=p_rate,is_active=p_active where id=p_id and organization_id=org and product_type='service' returning id into result;
 if result is null then raise exception 'Service unavailable';end if;end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(org,auth.uid(),'farm_service_saved','product',result::text,jsonb_build_object('name',p_name,'unit',p_unit,'rate',p_rate));return result;
end $$;

commit;
