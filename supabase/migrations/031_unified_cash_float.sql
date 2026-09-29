-- Admin-funded cash float and one receipt for purchasing and expense cash.
begin;
create table public.admin_cash_in (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 amount numeric(18,2) not null check(amount>0), source text not null check(source in ('owner_cash','bank_withdrawal','other')),
 source_details text not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.center_cash_issues (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 center_id uuid not null references public.centers(id), reference text not null,
 purchase_issued numeric(18,2) not null check(purchase_issued>=0), expense_issued numeric(18,2) not null check(expense_issued>=0),
 purchase_received numeric(18,2) check(purchase_received>=0), expense_received numeric(18,2) check(expense_received>=0),
 status text not null default 'pending' check(status in ('pending','received')),
 issued_by uuid not null references public.profiles(id), received_by uuid references public.profiles(id),
 issued_at timestamptz not null default now(), received_at timestamptz,
 check(purchase_issued+expense_issued>0),
 check((status='pending' and purchase_received is null and expense_received is null and received_at is null) or (status='received' and purchase_received is not null and expense_received is not null and received_at is not null))
);
create index on public.admin_cash_in(organization_id,created_at desc);
create index on public.center_cash_issues(organization_id,center_id,issued_at desc);
alter table public.admin_cash_in enable row level security;
alter table public.center_cash_issues enable row level security;
create policy admin_cash_in_read on public.admin_cash_in for select using(public.is_admin() and organization_id=(public.current_profile()).organization_id);
create policy center_cash_issues_read on public.center_cash_issues for select using(organization_id=(public.current_profile()).organization_id and public.can_access_center(center_id));
grant select on public.admin_cash_in,public.center_cash_issues to authenticated;

create function public.cash_float_available() returns numeric language plpgsql stable security definer set search_path=public as $$
declare v_org uuid;
begin
 if not public.is_admin() then raise exception 'Access denied'; end if;
 v_org:=(public.current_profile()).organization_id;
 return (select coalesce((select sum(amount) from public.admin_cash_in where organization_id=v_org),0)
 -coalesce((select sum(case when status='pending' then purchase_issued+expense_issued else purchase_received+expense_received end) from public.center_cash_issues where organization_id=v_org),0))::numeric(18,2);
end $$;

create function public.record_admin_cash_in(p_amount numeric,p_source text,p_details text) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid;v_id uuid;
begin
 if not public.is_admin() then raise exception 'Access denied'; end if;
 v_org:=(public.current_profile()).organization_id;
 if v_org is null or p_amount is null or round(p_amount,2)<=0 or p_source not in ('owner_cash','bank_withdrawal','other') or nullif(trim(p_details),'') is null then raise exception 'Enter an amount, source and reference'; end if;
 insert into public.admin_cash_in(organization_id,amount,source,source_details,created_by) values(v_org,round(p_amount,2),p_source,trim(p_details),auth.uid()) returning id into v_id;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(v_org,auth.uid(),'admin_cash_in','admin_cash_in',v_id::text,jsonb_build_object('amount',round(p_amount,2),'source',p_source,'details',p_details));
 return v_id;
end $$;

create function public.issue_combined_center_cash(p_center uuid,p_purchase numeric,p_expense numeric,p_reference text) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid;v_id uuid;v_purchase numeric(18,2);v_expense numeric(18,2);v_available numeric;
begin
 if not public.is_admin() then raise exception 'Access denied'; end if;
 v_org:=(public.current_profile()).organization_id;
 select organization_id into strict v_org from public.centers where id=p_center and is_active and organization_id=v_org;
 v_purchase:=round(coalesce(p_purchase,0),2);v_expense:=round(coalesce(p_expense,0),2);
 if v_purchase<0 or v_expense<0 or v_purchase+v_expense<=0 or nullif(trim(p_reference),'') is null then raise exception 'Enter valid amounts and reference'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_org::text,31));
 v_available:=public.cash_float_available();
 if v_available<v_purchase+v_expense then raise exception 'Insufficient admin cash float'; end if;
 insert into public.center_cash_issues(organization_id,center_id,reference,purchase_issued,expense_issued,issued_by)
 values(v_org,p_center,trim(p_reference),v_purchase,v_expense,auth.uid()) returning id into v_id;
 insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
 values(v_org,'combined_cash_issued','Cash awaiting receipt','Purchasing LKR '||v_purchase||' and expense LKR '||v_expense||' issued. Reference: '||trim(p_reference),p_center,v_id,'center');
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(v_org,auth.uid(),'combined_cash_issued','center_cash_issue',v_id::text,jsonb_build_object('center_id',p_center,'purchase',v_purchase,'expense',v_expense));
 return v_id;
exception when no_data_found then raise exception 'Invalid center';
end $$;

create function public.receive_combined_center_cash(p_issue uuid,p_purchase numeric,p_expense numeric) returns void language plpgsql security definer set search_path=public as $$
declare v_row public.center_cash_issues%rowtype;v_actor public.profiles%rowtype;v_purchase numeric(18,2);v_expense numeric(18,2);
begin
 select * into v_actor from public.profiles where id=auth.uid() and is_active;
 if v_actor.id is null or v_actor.role<>'center_user' then raise exception 'Only center users can receive cash'; end if;
 select * into v_row from public.center_cash_issues where id=p_issue for update;
 if not found or v_row.organization_id<>v_actor.organization_id or not public.can_access_center(v_row.center_id) then raise exception 'Cash issue not found'; end if;
 if v_row.status<>'pending' then raise exception 'Already received'; end if;
 if p_purchase is null or p_expense is null or p_purchase<0 or p_expense<0 then raise exception 'Enter both received amounts'; end if;
 v_purchase:=round(p_purchase,2);v_expense:=round(p_expense,2);
 update public.center_cash_issues set purchase_received=v_purchase,expense_received=v_expense,status='received',received_by=auth.uid(),received_at=now() where id=p_issue;
 if v_purchase>0 then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(v_row.organization_id,v_row.center_id,'allocation',v_purchase,'combined_cash_issue',p_issue,'Purchasing cash received: '||v_row.reference,auth.uid()); end if;
 if v_expense>0 then insert into public.expense_cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(v_row.organization_id,v_row.center_id,'allocation',v_expense,'combined_cash_issue',p_issue,'Expense cash received: '||v_row.reference,auth.uid()); end if;
 insert into public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
 values(v_row.organization_id,case when v_purchase<>v_row.purchase_issued or v_expense<>v_row.expense_issued then 'cash_difference' else 'cash_received' end,
 'Center cash received','Issued purchasing '||v_row.purchase_issued||', expense '||v_row.expense_issued||'; received purchasing '||v_purchase||', expense '||v_expense||'.',v_row.center_id,p_issue,'admin');
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(v_row.organization_id,auth.uid(),'combined_cash_received','center_cash_issue',p_issue::text,jsonb_build_object('purchase_received',v_purchase,'expense_received',v_expense));
end $$;
revoke all on function public.cash_float_available() from public;
revoke all on function public.record_admin_cash_in(numeric,text,text) from public;
revoke all on function public.issue_combined_center_cash(uuid,numeric,numeric,text) from public;
revoke all on function public.receive_combined_center_cash(uuid,numeric,numeric) from public;
grant execute on function public.cash_float_available(),public.record_admin_cash_in(numeric,text,text),public.issue_combined_center_cash(uuid,numeric,numeric,text),public.receive_combined_center_cash(uuid,numeric,numeric) to authenticated;
commit;
