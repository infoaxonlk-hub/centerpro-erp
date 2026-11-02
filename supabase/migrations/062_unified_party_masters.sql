begin;
-- Classification is independent of VAT; existing parties remain unspecified.
alter table public.customers add column party_classification text check(party_classification in ('individual','company'));
alter table public.suppliers add column party_classification text check(party_classification in ('individual','company'));

create function public.guard_party_classification() returns trigger language plpgsql security definer set search_path=public as $$
declare k text:=case tg_table_name when 'customers' then 'customer' else 'supplier' end;begin
 if (tg_op='INSERT' and new.party_classification is not null) or (tg_op='UPDATE' and new.party_classification is distinct from old.party_classification) then
  if not public.is_admin() or (tg_op='UPDATE' and not public.legal_master_access(k,old.id,true)) then raise exception 'legal.access_denied' using errcode='42501';end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(new.organization_id,auth.uid(),'party_classification_changed',k,new.id::text,jsonb_build_object('field','party_classification'));
 end if;
 if tg_op='UPDATE' and (to_jsonb(new)-array['legal_revision','registered_name','trading_name','legal_email','business_registration_number','tin','payment_terms_days','payment_terms_note','updated_at']) is distinct from (to_jsonb(old)-array['legal_revision','registered_name','trading_name','legal_email','business_registration_number','tin','payment_terms_days','payment_terms_note','updated_at']) then new.legal_revision:=old.legal_revision+1;end if;
 return new;
end $$;
revoke all on function public.guard_party_classification() from public,anon,authenticated;
create trigger party_classification_guard before insert or update on public.customers for each row execute function public.guard_party_classification();
create trigger party_classification_guard before insert or update on public.suppliers for each row execute function public.guard_party_classification();

-- Same underlying party and legal records, with the existing access checks.
-- Private supplier fields never enter read_legal_master or document snapshots.
create function public.read_party_master(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare legal jsonb;basic jsonb;begin
 if p_kind not in ('customer','supplier') or p_kind is null then raise exception 'legal.invalid_data';end if;
 legal:=public.read_legal_master(p_kind,p_id);
 if p_kind='customer' then
  select jsonb_build_object('phone',phone,'address',address,'is_active',is_active,'center_id',center_id,'party_classification',party_classification) into basic from public.customers where id=p_id;
 else
  select jsonb_build_object('phone',phone,'address',address,'is_active',is_active,'nic_or_registration',nic_or_registration,'notes',notes,'bank_details',bank_details,'party_classification',party_classification) into basic from public.suppliers where id=p_id;
 end if;
 return legal||basic;
end $$;
revoke all on function public.read_party_master(text,uuid) from public,anon;
grant execute on function public.read_party_master(text,uuid) to authenticated;

create function public.save_party_master(p_kind text,p_id uuid,p_data jsonb,p_center uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;previous jsonb:='{}';field text;limit_value integer;begin
 if p_kind not in ('customer','supplier') or p_kind is null then raise exception 'legal.invalid_data';end if;
 if p_id is not null then previous:=public.read_party_master(p_kind,p_id);end if;
 for field,limit_value in select key,value::integer from jsonb_each_text('{"phone":50,"address":500,"nic_or_registration":200,"notes":2000,"bank_details":2000}'::jsonb) loop
  if length(coalesce(p_data->>field,''))>limit_value and (p_id is null or p_data->field is distinct from previous->field) then raise exception 'legal.invalid_data';end if;
 end loop;
 -- Reuse 061's permissions, parent lock, revision, address/VAT validation and
 -- audit. A failure below rolls that complete save back in the same transaction.
 result:=public.save_legal_master(p_kind,p_id,p_data,p_center);
 if p_kind='customer' then
  update public.customers set phone=case when p_data?'phone' and p_data->'phone' is distinct from previous->'phone' then nullif(trim(p_data->>'phone'),'') else phone end,address=case when p_data?'address' and p_data->'address' is distinct from previous->'address' then nullif(trim(p_data->>'address'),'') else address end,is_active=coalesce((p_data->>'is_active')::boolean,is_active),party_classification=case when p_data?'party_classification' then nullif(p_data->>'party_classification','') else party_classification end where id=result;
 else
  update public.suppliers set phone=case when p_data?'phone' and p_data->'phone' is distinct from previous->'phone' then nullif(trim(p_data->>'phone'),'') else phone end,address=case when p_data?'address' and p_data->'address' is distinct from previous->'address' then nullif(trim(p_data->>'address'),'') else address end,is_active=coalesce((p_data->>'is_active')::boolean,is_active),party_classification=case when p_data?'party_classification' then nullif(p_data->>'party_classification','') else party_classification end,nic_or_registration=case when p_data?'nic_or_registration' and p_data->'nic_or_registration' is distinct from previous->'nic_or_registration' then nullif(trim(p_data->>'nic_or_registration'),'') else nic_or_registration end,notes=case when p_data?'notes' and p_data->'notes' is distinct from previous->'notes' then nullif(trim(p_data->>'notes'),'') else notes end,bank_details=case when p_data?'bank_details' and p_data->'bank_details' is distinct from previous->'bank_details' then nullif(trim(p_data->>'bank_details'),'') else bank_details end where id=result;
 end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values((public.current_profile()).organization_id,auth.uid(),'party_master_saved',p_kind,result::text,jsonb_build_object('basic_fields_saved',true));
 return result;
end $$;
revoke all on function public.save_party_master(text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_party_master(text,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
