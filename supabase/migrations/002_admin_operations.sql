create or replace function public.create_center_with_default_location(
  center_code text,
  center_name text,
  center_address text default null,
  center_phone text default null,
  multiple_locations boolean default false
)
returns uuid language plpgsql security definer set search_path=public
as $$
declare org_id uuid; center_id uuid;
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if trim(center_code)='' or trim(center_name)='' then raise exception 'Center code and name are required'; end if;
  select organization_id into org_id from public.profiles where id=auth.uid();
  insert into public.centers(organization_id,code,name,address,phone,allow_multiple_locations)
  values(org_id,upper(trim(center_code)),trim(center_name),nullif(trim(center_address),''),nullif(trim(center_phone),''),multiple_locations)
  returning id into center_id;
  insert into public.locations(center_id,code,name,is_default)
  values(center_id,'MAIN','Main Stock Location',true);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(org_id,auth.uid(),'center_created','center',center_id::text,jsonb_build_object('code',upper(trim(center_code)),'name',trim(center_name),'multiple_locations',multiple_locations));
  return center_id;
end $$;

create or replace function public.issue_center_cash(target_center uuid, issue_amount numeric, issue_reference text, issue_note text default null)
returns uuid language plpgsql security definer set search_path=public
as $$
declare org_id uuid; ledger_id uuid;
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if issue_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  select organization_id into org_id from public.centers where id=target_center and is_active;
  if org_id is null or org_id<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
  insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,note,created_by)
  values(org_id,target_center,'allocation',round(issue_amount,2),coalesce(nullif(trim(issue_reference),''),'cash_issue'),nullif(trim(issue_note),''),auth.uid())
  returning id into ledger_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(org_id,auth.uid(),'cash_issued','cash_ledger',ledger_id::text,jsonb_build_object('center_id',target_center,'amount',round(issue_amount,2),'reference',issue_reference));
  return ledger_id;
end $$;

grant execute on function public.create_center_with_default_location(text,text,text,text,boolean) to authenticated;
grant execute on function public.issue_center_cash(uuid,numeric,text,text) to authenticated;
