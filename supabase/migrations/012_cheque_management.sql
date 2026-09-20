-- Cheque lifecycle tracking and organization-level due-date reminder setting.
alter table public.organizations
  add column if not exists cheque_reminder_days integer not null default 3
  check (cheque_reminder_days between 0 and 90);

alter table public.payments
  add column if not exists cheque_status text not null default 'pending',
  add column if not exists cheque_notes text,
  add column if not exists cheque_status_updated_at timestamptz,
  add column if not exists cheque_status_updated_by uuid references public.profiles(id);

alter table public.payments drop constraint if exists payments_cheque_status_check;
alter table public.payments add constraint payments_cheque_status_check
  check (cheque_status in ('pending','deposited','cleared','bounced','cancelled'));

create or replace function public.update_cheque_status(
  target_payment uuid,
  target_status text,
  target_notes text default null
)
returns void language plpgsql security definer set search_path=public as $$
declare v_payment public.payments%rowtype;
begin
  if not public.is_admin() then raise exception 'Only an administrator can update cheque status'; end if;
  if target_status not in ('pending','deposited','cleared','bounced','cancelled') then raise exception 'Invalid cheque status'; end if;
  select * into v_payment from public.payments where id=target_payment and method='cheque' for update;
  if not found or v_payment.organization_id<>(public.current_profile()).organization_id then raise exception 'Cheque not found'; end if;
  update public.payments set cheque_status=target_status,cheque_notes=nullif(trim(target_notes),''),cheque_status_updated_at=now(),cheque_status_updated_by=auth.uid() where id=target_payment;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data)
  values(v_payment.organization_id,auth.uid(),'cheque_status_updated','payment',target_payment::text,
    jsonb_build_object('status',v_payment.cheque_status,'notes',v_payment.cheque_notes),
    jsonb_build_object('status',target_status,'notes',nullif(trim(target_notes),'')));
end $$;

create or replace function public.update_cheque_reminder_days(target_days integer)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid;
begin
  if not public.is_admin() then raise exception 'Only an administrator can change reminder settings'; end if;
  if target_days is null or target_days<0 or target_days>90 then raise exception 'Reminder days must be between 0 and 90'; end if;
  v_org:=(public.current_profile()).organization_id;
  update public.organizations set cheque_reminder_days=target_days,updated_at=now() where id=v_org;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(v_org,auth.uid(),'cheque_reminder_updated','organization',v_org::text,jsonb_build_object('reminder_days',target_days));
end $$;

revoke all on function public.update_cheque_status(uuid,text,text) from public;
revoke all on function public.update_cheque_reminder_days(integer) from public;
grant execute on function public.update_cheque_status(uuid,text,text) to authenticated;
grant execute on function public.update_cheque_reminder_days(integer) to authenticated;
