create or replace function public.update_organization_receipt_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_old_name text;
  v_name text := trim(coalesce(p_name, ''));
begin
  select * into v_profile from public.profiles where id = auth.uid() and is_active;
  if not found or v_profile.role not in ('admin', 'super_admin') then
    raise exception 'Only an administrator can change the company name';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Company name must be between 1 and 120 characters';
  end if;

  select name into v_old_name from public.organizations where id = v_profile.organization_id for update;
  if not found then raise exception 'Organization not found'; end if;

  update public.organizations set name = v_name, updated_at = now()
  where id = v_profile.organization_id;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values(v_profile.organization_id, auth.uid(), 'organization_receipt_name_updated', 'organization',
    v_profile.organization_id::text, jsonb_build_object('name', v_old_name), jsonb_build_object('name', v_name));
end;
$$;

revoke all on function public.update_organization_receipt_name(text) from public;
grant execute on function public.update_organization_receipt_name(text) to authenticated;
