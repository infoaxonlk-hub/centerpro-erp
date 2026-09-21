-- Initial production bootstrap for infoaxonlk@gmail.com.
-- Auth user id: 50438cd5-19c0-4a32-b605-672b98ee6a56
begin;
with new_org as (
  insert into public.organizations(name) values ('CenterPro') returning id
), new_profile as (
  insert into public.profiles(id, organization_id, full_name, role)
  select '50438cd5-19c0-4a32-b605-672b98ee6a56'::uuid, id, 'Viraj Bandara', 'super_admin' from new_org
  returning organization_id
), new_center as (
  insert into public.centers(organization_id,code,name,allow_multiple_locations)
  select organization_id,'MAIN','Main Collection Center',false from new_profile returning id
)
insert into public.locations(center_id,code,name,is_default)
select id,'MAIN','Main Stock Location',true from new_center;
commit;
