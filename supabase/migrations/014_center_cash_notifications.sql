-- Notifications can now be delivered separately to administrators or center users.
alter table public.notifications
  add column if not exists audience text not null default 'admin'
  check (audience in ('admin','center','all'));

drop policy if exists "admins read notifications" on public.notifications;
drop policy if exists "admins update notifications" on public.notifications;
create policy "users read relevant notifications" on public.notifications for select using (
  organization_id=(public.current_profile()).organization_id
  and ((public.is_admin() and audience in ('admin','all')) or (audience in ('center','all') and center_id is not null and public.can_access_center(center_id)))
);
create policy "users mark relevant notifications read" on public.notifications for update using (
  organization_id=(public.current_profile()).organization_id
  and ((public.is_admin() and audience in ('admin','all')) or (audience in ('center','all') and center_id is not null and public.can_access_center(center_id)))
) with check (
  organization_id=(public.current_profile()).organization_id
  and ((public.is_admin() and audience in ('admin','all')) or (audience in ('center','all') and center_id is not null and public.can_access_center(center_id)))
);

create or replace function public.issue_center_cash(target_center uuid, issue_amount numeric, issue_reference text, issue_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid; handover_id uuid; center_label text;
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if issue_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  select organization_id,code||' · '||name into org_id,center_label from public.centers where id=target_center and is_active;
  if org_id is null or org_id<>(public.current_profile()).organization_id then raise exception 'Invalid center'; end if;
  insert into public.cash_handovers(organization_id,center_id,issued_amount,reference,issue_note,issued_by)
  values(org_id,target_center,round(issue_amount,2),coalesce(nullif(trim(issue_reference),''),'cash_issue'),nullif(trim(issue_note),''),auth.uid()) returning id into handover_id;
  insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
  values(org_id,'cash_issued','Cash awaiting receipt','Admin issued LKR '||to_char(round(issue_amount,2),'FM999G999G999G990D00')||' to '||center_label||'. Reference: '||coalesce(nullif(trim(issue_reference),''),'cash_issue')||'. Please confirm the amount received.',target_center,handover_id,'center');
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(org_id,auth.uid(),'cash_handover_issued','cash_handover',handover_id::text,jsonb_build_object('center_id',target_center,'issued_amount',round(issue_amount,2),'reference',issue_reference,'status','pending'));
  return handover_id;
end $$;

create or replace function public.respond_cash_handover(target_handover uuid,response_action text,actual_received numeric default null,response_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare h public.cash_handovers%rowtype; actor public.profiles%rowtype; diff numeric(18,2); ledger_id uuid; notice_title text; notice_message text;
begin
  select * into actor from public.profiles where id=auth.uid() and is_active;
  if actor.id is null or actor.role<>'center_user' then raise exception 'Only an active center user can respond to a cash handover'; end if;
  select * into h from public.cash_handovers where id=target_handover for update;
  if not found or h.organization_id<>actor.organization_id or not public.can_access_center(h.center_id) then raise exception 'Cash handover not found'; end if;
  if h.status<>'pending' then raise exception 'This cash handover has already been responded to'; end if;
  if response_action not in ('accept','reject') then raise exception 'Invalid response'; end if;
  if response_action='reject' then
    if nullif(trim(response_reason),'') is null then raise exception 'A rejection reason is required'; end if;
    diff:=round(coalesce(actual_received,0)-h.issued_amount,2);
    update public.cash_handovers set status='rejected',received_amount=coalesce(actual_received,0),difference_amount=diff,response_note=trim(response_reason),received_by=auth.uid(),responded_at=now() where id=h.id;
    notice_title:='Center rejected cash handover'; notice_message:='Issued LKR '||to_char(h.issued_amount,'FM999G999G999G990D00')||' was rejected. Reason: '||trim(response_reason);
  else
    if actual_received is null or actual_received<0 then raise exception 'Enter the actual received amount'; end if;
    diff:=round(actual_received-h.issued_amount,2);
    if diff<>0 and nullif(trim(response_reason),'') is null then raise exception 'A reason is required when the received amount is different'; end if;
    update public.cash_handovers set status='accepted',received_amount=round(actual_received,2),difference_amount=diff,response_note=nullif(trim(response_reason),''),received_by=auth.uid(),responded_at=now() where id=h.id;
    if actual_received>0 then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(h.organization_id,h.center_id,'allocation',round(actual_received,2),'cash_handover',h.id,'Received against '||h.reference,auth.uid()) returning id into ledger_id; end if;
    if diff=0 then notice_title:='Center received cash'; notice_message:='Cash handover '||h.reference||' was received in full: LKR '||to_char(actual_received,'FM999G999G999G990D00'); else notice_title:='Cash handover difference reported'; notice_message:='Issued LKR '||to_char(h.issued_amount,'FM999G999G999G990D00')||', received LKR '||to_char(actual_received,'FM999G999G999G990D00')||', difference LKR '||to_char(diff,'FM999G999G999G990D00')||'. Reason: '||trim(response_reason); end if;
  end if;
  insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
  values(h.organization_id,case when response_action='reject' then 'cash_rejected' when coalesce(diff,0)<>0 then 'cash_difference' else 'cash_received' end,notice_title,notice_message,h.center_id,h.id,'admin');
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data)
  values(h.organization_id,auth.uid(),'cash_handover_'||case when response_action='accept' then 'accepted' else 'rejected' end,'cash_handover',h.id::text,jsonb_build_object('status','pending','issued_amount',h.issued_amount),jsonb_build_object('status',case when response_action='accept' then 'accepted' else 'rejected' end,'received_amount',actual_received,'difference',diff,'reason',response_reason,'ledger_id',ledger_id));
end $$;
