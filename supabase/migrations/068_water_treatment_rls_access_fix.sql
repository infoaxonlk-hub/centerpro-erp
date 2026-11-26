begin;

create or replace function public.current_business_module_enabled(p_module text)
returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((
    select public.business_module_enabled(p.organization_id,p_module)
    from public.profiles p
    where p.id=auth.uid()
      and p.is_active
      and p.organization_id is not null
    limit 1
  ),false)
$$;
revoke all on function public.current_business_module_enabled(text) from public,anon,authenticated;
grant execute on function public.current_business_module_enabled(text) to authenticated;

alter policy water_treatment_plants_read on public.water_treatment_plants
  using (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.current_business_module_enabled('water_treatment')
    and public.can_access_center(center_id)
  );

alter policy water_treatment_plants_insert on public.water_treatment_plants
  with check (
    organization_id=(public.current_profile()).organization_id
    and created_by=auth.uid()
    and public.has_permission('water_treatment')
    and public.current_business_module_enabled('water_treatment')
    and public.can_access_center(center_id)
  );

alter policy water_treatment_plants_update on public.water_treatment_plants
  using (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.current_business_module_enabled('water_treatment')
    and public.can_access_center(center_id)
  )
  with check (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.current_business_module_enabled('water_treatment')
    and public.can_access_center(center_id)
  );

alter policy water_treatment_plant_history_read on public.water_treatment_plant_history
  using (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.current_business_module_enabled('water_treatment')
    and public.can_access_center(center_id)
  );

alter policy water_treatment_plant_history_insert on public.water_treatment_plant_history
  with check (
    organization_id=(public.current_profile()).organization_id
    and recorded_by=auth.uid()
    and public.has_permission('water_treatment')
    and public.current_business_module_enabled('water_treatment')
    and public.can_access_center(center_id)
  );

alter policy water_treatment_customer_read on public.customers
  using (
    organization_id=(public.current_profile()).organization_id
    and public.has_permission('water_treatment')
    and public.current_business_module_enabled('water_treatment')
    and public.can_access_center(center_id)
  );

commit;
