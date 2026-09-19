alter table public.profiles
  add column if not exists email text,
  add column if not exists permissions text[] not null default array['dashboard']::text[];

update public.profiles p set email=u.email from auth.users u where u.id=p.id and p.email is null;
update public.profiles set permissions=array['dashboard','purchases','stock','cash','centers','users','masters','audit']::text[] where role='super_admin';

create or replace function public.protect_super_admin()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.role='super_admin' and (new.role<>'super_admin' or new.is_active=false) then
    raise exception 'The Super Admin account cannot be deactivated or demoted';
  end if;
  return new;
end $$;
drop trigger if exists protect_super_admin_profile on public.profiles;
create trigger protect_super_admin_profile before update on public.profiles for each row execute function public.protect_super_admin();

create or replace function public.has_permission(required_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select is_active and (role='super_admin' or required_permission=any(permissions)) from public.profiles where id=auth.uid()),false)
$$;
grant execute on function public.has_permission(text) to authenticated;
