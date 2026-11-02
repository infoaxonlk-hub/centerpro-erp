begin;
-- Optional private master data only. No backfill from supplier identifiers.
alter table public.customers add column if not exists nic text;
do $$ begin
 if (select data_type from information_schema.columns where table_schema='public' and table_name='customers' and column_name='nic') not in ('text','character varying') then
  raise exception 'Customer NIC must be a text column; existing data was not changed';
 end if;
end $$;

create or replace function public.validate_customer_nic() returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- Unchanged legacy values are neither rejected nor silently normalized.
 if tg_op='UPDATE' and new.nic is not distinct from old.nic then return new;end if;
 if tg_op='INSERT' and new.nic is null then return new;end if;
 if auth.uid() is not null then
  if tg_op='UPDATE' then
   if not public.legal_master_access('customer',old.id,true) then raise exception 'legal.access_denied' using errcode='42501';end if;
  elsif not public.is_admin() or not public.can_access_center(new.center_id) or not (public.sales_center_access(new.center_id) and public.business_module_enabled(new.organization_id,'sales') or public.farm_center_access(new.center_id)) then
   raise exception 'legal.access_denied' using errcode='42501';
  end if;
 end if;
 -- Match browser String.trim whitespace, including non-breaking spaces/BOM.
 new.nic:=nullif(btrim(new.nic,E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'');
 if new.nic is not null then
  new.nic:=regexp_replace(new.nic,'[vx]$',upper(right(new.nic,1)));
  if new.nic !~ '^([0-9]{9}[VX]|[0-9]{12})$' then raise exception 'party.invalid_nic' using errcode='23514';end if;
 end if;
 if auth.uid() is not null then
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(new.organization_id,auth.uid(),'customer_nic_changed','customer',new.id::text,jsonb_build_object('field','nic'));
 end if;
 return new;
end $$;
revoke all on function public.validate_customer_nic() from public,anon,authenticated;
drop trigger if exists customer_nic_guard on public.customers;
create trigger customer_nic_guard before insert or update on public.customers for each row execute function public.validate_customer_nic();

-- Preserve existing RPC contracts, access checks and atomic legal/basic saves.
-- NIC is available only in the explicit master detail, not legal snapshots.
do $$ declare definition text;marker text;begin
 definition:=pg_get_functiondef('public.read_party_master(text,uuid)'::regprocedure);
 marker:='return legal||basic;';
 if position(marker in definition)=0 then raise exception 'read_party_master implementation marker missing; apply 062/063 first';end if;
 definition:=replace(definition,marker,$code$
 if p_kind='customer' then select basic||jsonb_build_object('nic',nic) into basic from public.customers where id=p_id;end if;
 return legal||basic;
 $code$);
 execute definition;
 definition:=pg_get_functiondef('public.save_party_master(text,uuid,jsonb,uuid)'::regprocedure);
 marker:='result:=public.save_legal_master(p_kind,p_id,p_data,p_center);';
 if position(marker in definition)=0 then raise exception 'save_party_master implementation marker missing; apply 062/063 first';end if;
 definition:=replace(definition,marker,marker||$code$
 if p_kind='customer' and p_data?'nic' then
  if jsonb_typeof(p_data->'nic') not in ('string','null') then raise exception 'party.invalid_nic' using errcode='23514';end if;
  update public.customers set nic=p_data->>'nic' where id=result;
 end if;
 $code$);
 execute definition;
end $$;
revoke all on function public.read_party_master(text,uuid),public.save_party_master(text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.read_party_master(text,uuid),public.save_party_master(text,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
