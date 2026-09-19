update public.organizations
set name='CollectPro', updated_at=now()
where id=(select organization_id from public.profiles where id='50438cd5-19c0-4a32-b605-672b98ee6a56'::uuid);

insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
select organization_id,id,'organization_renamed','organization',organization_id::text,jsonb_build_object('name','CollectPro')
from public.profiles where id='50438cd5-19c0-4a32-b605-672b98ee6a56'::uuid;
