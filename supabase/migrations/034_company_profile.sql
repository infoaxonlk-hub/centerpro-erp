alter table public.organizations add column if not exists receipt_address text;
alter table public.organizations add column if not exists receipt_phone text;
alter table public.organizations add column if not exists receipt_email text;
create or replace function public.update_company_profile(p_name text,p_address text,p_phone text,p_email text)
returns void language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles; v_before jsonb; v_name text:=trim(coalesce(p_name,''));
begin
 select * into v_profile from public.profiles where id=auth.uid() and is_active;
 if not found or v_profile.role not in ('admin','super_admin') then raise exception 'Only administrators can update the company profile'; end if;
 if length(v_name)<1 or length(v_name)>120 then raise exception 'Company name must be between 1 and 120 characters'; end if;
 if length(coalesce(p_address,''))>500 or length(coalesce(p_phone,''))>50 or length(coalesce(p_email,''))>254 then raise exception 'Company contact details are too long'; end if;
 select jsonb_build_object('name',name,'address',receipt_address,'phone',receipt_phone,'email',receipt_email) into v_before from public.organizations where id=v_profile.organization_id for update;
 if not found then raise exception 'Organization not found'; end if;
 update public.organizations set name=v_name,receipt_address=nullif(trim(p_address),''),receipt_phone=nullif(trim(p_phone),''),receipt_email=nullif(trim(p_email),''),updated_at=now() where id=v_profile.organization_id;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(v_profile.organization_id,auth.uid(),'company_profile_updated','organization',v_profile.organization_id::text,v_before,jsonb_build_object('name',v_name,'address',p_address,'phone',p_phone,'email',p_email));
end;
$$;
revoke all on function public.update_company_profile(text,text,text,text) from public;
grant execute on function public.update_company_profile(text,text,text,text) to authenticated;
