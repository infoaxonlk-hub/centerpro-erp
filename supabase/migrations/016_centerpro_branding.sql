-- Rename the existing live organization without changing any transactional data.
update public.organizations
set name='CenterPro', updated_at=now()
where name='CollectPro';

insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
select organization_id,id,'organization_renamed','organization',organization_id::text,jsonb_build_object('name','CenterPro')
from public.profiles
where role='super_admin'
on conflict do nothing;
