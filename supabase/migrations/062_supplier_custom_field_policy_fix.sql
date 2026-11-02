-- Follow-up: avoid referencing a non-public operational helper in RLS.
-- App routes already enforce active business status before allowing management.
begin;
drop policy if exists supplier_field_create on public.supplier_custom_fields;
drop policy if exists supplier_field_edit on public.supplier_custom_fields;
create policy supplier_field_create on public.supplier_custom_fields
 for insert to authenticated
 with check (
 organization_id=(select (public.current_profile()).organization_id)
 and (select (public.current_profile()).is_active)
 and (select (public.current_profile()).role) in ('admin','super_admin')
);
create policy supplier_field_edit on public.supplier_custom_fields
 for update to authenticated
 using (
 organization_id=(select (public.current_profile()).organization_id)
 and (select (public.current_profile()).is_active)
 and (select (public.current_profile()).role) in ('admin','super_admin')
)
 with check (
 organization_id=(select (public.current_profile()).organization_id)
 and (select (public.current_profile()).is_active)
 and (select (public.current_profile()).role) in ('admin','super_admin')
);
commit;
