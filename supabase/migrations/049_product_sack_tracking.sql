begin;
alter table public.products add column tracks_sacks boolean not null default false;
alter table public.sales_order_lines add column sack_count integer check(sack_count>=0);
alter table public.stock_transfer_lines add column sack_count integer check(sack_count>=0);
alter table public.stock_scrap_lines add column sack_count integer check(sack_count>=0);
alter table public.bill_return_lines add column sack_count integer check(sack_count>=0);
alter table public.stock_adjustments add column previous_sacks integer, add column counted_sacks integer check(counted_sacks>=0);
alter table public.stock_adjustments drop constraint stock_adjustments_difference_check;
alter table public.stock_adjustments add constraint stock_adjustments_difference_check check(difference<>0 or counted_sacks is distinct from previous_sacks);

-- A separate signed ledger permits opening counts and sack-only corrections
-- without inventing a weight or a fixed kilograms-per-sack conversion.
create table public.stock_sack_movements(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 center_id uuid not null references public.centers,location_id uuid not null references public.locations,
 product_id uuid not null references public.products,quality_id uuid not null references public.product_qualities,
 delta integer not null,reference_type text not null,reference_id uuid not null,
 source_line_id uuid not null,created_by uuid references public.profiles,created_at timestamptz not null default now(),
 unique(reference_type,reference_id,source_line_id,center_id,location_id)
);
create index stock_sack_balance on public.stock_sack_movements(center_id,location_id,product_id,quality_id);
alter table public.stock_sack_movements enable row level security;
revoke all on public.stock_sack_movements from public,anon,authenticated;
grant select on public.stock_sack_movements to authenticated;
create policy sack_stock_read on public.stock_sack_movements for select using(
 organization_id=(public.current_profile()).organization_id and public.can_access_center(center_id)
 and ((public.has_permission('stock') and public.business_table_access('stock_movements'))
 or (public.has_permission('sales') and public.business_table_access('sales_orders')))
);
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.business_table_modules(text,jsonb,boolean)'::regprocedure);
 definition:=replace(definition,'when p_table=''stock_movements'' then return array[''inventory''];',
 'when p_table=''stock_movements'' then return array[''inventory'']; when p_table=''stock_sack_movements'' then return case when p_write then array[''inventory''] else array[''inventory'',''sales''] end;');
 execute definition;
end $$;
create policy tenant_boundary on public.stock_sack_movements as restrictive for all to authenticated using(organization_id=(public.current_profile()).organization_id) with check(organization_id=(public.current_profile()).organization_id);
create policy business_operation_boundary on public.stock_sack_movements as restrictive for all to authenticated using(public.business_table_access('stock_sack_movements',to_jsonb(stock_sack_movements),false)) with check(public.business_table_access('stock_sack_movements',to_jsonb(stock_sack_movements),true));
create policy business_delete_boundary on public.stock_sack_movements as restrictive for delete to authenticated using(public.business_table_access('stock_sack_movements',to_jsonb(stock_sack_movements),true));
create trigger tenant_write_guard before insert or update or delete on public.stock_sack_movements for each row execute function public.enforce_tenant_write();
create trigger business_operation_guard before insert or update or delete on public.stock_sack_movements for each row execute function public.enforce_business_operation();

create function public.create_product_with_pricing(product_code text,product_name text,product_category_id uuid,product_unit text,global_price numeric,product_tracks_sacks boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; begin
 result:=public.create_product_with_pricing(product_code,product_name,product_category_id,product_unit,global_price);
 update public.products set tracks_sacks=coalesce(product_tracks_sacks,false) where id=result;
 return result;
end $$;
revoke all on function public.create_product_with_pricing(text,text,uuid,text,numeric,boolean) from public,anon;
grant execute on function public.create_product_with_pricing(text,text,uuid,text,numeric,boolean) to authenticated;

create function public.post_stock_sacks(p_org uuid,p_center uuid,p_location uuid,p_product uuid,p_quality uuid,p_delta integer,p_type text,p_reference uuid,p_line uuid)
returns void language plpgsql security definer set search_path=public as $$
declare available integer; begin
 if exists(select 1 from public.stock_sack_movements where reference_type=p_type and reference_id=p_reference and source_line_id=p_line and center_id=p_center and location_id=p_location) then return; end if;
 perform 1 from public.centers where id=p_center for update;
 if not exists(select 1 from public.centers c join public.locations l on l.center_id=c.id join public.products p on p.organization_id=c.organization_id join public.product_qualities q on q.product_id=p.id where c.id=p_center and l.id=p_location and p.id=p_product and q.id=p_quality and c.organization_id=p_org) then raise exception 'Invalid sack stock dimensions'; end if;
 select coalesce(sum(delta),0) into available from public.stock_sack_movements where center_id=p_center and location_id=p_location and product_id=p_product and quality_id=p_quality;
 if available+p_delta<0 then raise exception 'Insufficient sacks (available: %). Record an opening sack count in stock adjustments if needed.',available; end if;
 insert into public.stock_sack_movements(organization_id,center_id,location_id,product_id,quality_id,delta,reference_type,reference_id,source_line_id,created_by)
 values(p_org,p_center,p_location,p_product,p_quality,p_delta,p_type,p_reference,p_line,auth.uid());
end $$;
revoke all on function public.post_stock_sacks(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid) from public,anon,authenticated;

-- Context is set inside the existing guarded RPC loops. Ordinary clients have
-- no write privileges on bill lines or this ledger outside existing draft rules.
create function public.capture_line_sacks() returns trigger language plpgsql security definer set search_path=public as $$
declare payload jsonb:=nullif(current_setting('centerpro.sack_line',true),'')::jsonb; tracked boolean; original integer; returned integer; kind text; begin
 select tracks_sacks into tracked from public.products where id=new.product_id;
 if tg_table_name in ('stock_transfer_lines','stock_scrap_lines') then
   select coalesce(sum((x->>'sack_count')::integer),0) into new.sack_count from jsonb_array_elements(payload) x where x->>'product_id'=new.product_id::text and x->>'quality_id'=new.quality_id::text;
   if tracked and exists(select 1 from jsonb_array_elements(payload) x where x->>'product_id'=new.product_id::text and x->>'quality_id'=new.quality_id::text and (x->>'sack_count' is null or x->>'sack_count' !~ '^\d+$')) then raise exception 'Enter a whole sack count for the transfer'; end if;
 else
   if tracked and coalesce(payload->>'sack_count','') !~ '^\d+$' then raise exception 'Enter a whole sack count (zero for loose stock)'; end if;
   new.sack_count:=coalesce((payload->>'sack_count')::integer,0);
 end if;
 if tg_table_name='bill_return_lines' then
   select bill_type into kind from public.bill_returns where id=new.return_id;
   if kind='sale' then select sack_count into original from public.sales_order_lines where id=new.source_line_id;
   else select sack_count into original from public.purchase_order_lines where id=new.source_line_id; end if;
   select coalesce(sum(l.sack_count),0) into returned from public.bill_return_lines l join public.bill_returns r on r.id=l.return_id where r.bill_type=kind and r.status in ('pending','approved') and l.source_line_id=new.source_line_id;
   if new.sack_count+returned>coalesce(original,0) then raise exception 'Return sacks exceed the unreturned sack count'; end if;
 end if;
 return new;
end $$;
revoke all on function public.capture_line_sacks() from public,anon,authenticated;
create trigger capture_sale_sacks before insert on public.sales_order_lines for each row execute function public.capture_line_sacks();
create trigger capture_transfer_sacks before insert on public.stock_transfer_lines for each row execute function public.capture_line_sacks();
create trigger capture_return_sacks before insert on public.bill_return_lines for each row execute function public.capture_line_sacks();
create trigger capture_scrap_sacks before insert on public.stock_scrap_lines for each row execute function public.capture_line_sacks();

create function public.post_line_sacks() returns trigger language plpgsql security definer set search_path=public as $$
declare parent record; begin
 if coalesce(new.sack_count,0)=0 and not (select tracks_sacks from public.products where id=new.product_id) then return new; end if;
 if tg_table_name='sales_order_lines' then
   select organization_id,center_id into parent from public.sales_orders where id=new.sales_order_id;
   perform public.post_stock_sacks(parent.organization_id,parent.center_id,new.location_id,new.product_id,new.quality_id,-coalesce(new.sack_count,0),'sale',new.sales_order_id,new.id);
 elsif tg_table_name='purchase_order_lines' then
   select organization_id,center_id,status into parent from public.purchase_orders where id=new.purchase_order_id;
   if parent.status='confirmed' and new.sack_count>0 then
    perform public.post_stock_sacks(parent.organization_id,parent.center_id,new.location_id,new.product_id,new.quality_id,new.sack_count,'purchase',new.purchase_order_id,new.id);
   end if;
 elsif tg_table_name='stock_scrap_lines' then
   select * into parent from public.stock_scraps where id=new.scrap_id;
   perform public.post_stock_sacks(parent.organization_id,parent.center_id,parent.location_id,new.product_id,new.quality_id,-coalesce(new.sack_count,0),'scrap',new.scrap_id,new.id);
 else
   select * into parent from public.stock_transfers where id=new.transfer_id;
   perform public.post_stock_sacks(parent.organization_id,parent.from_center_id,parent.from_location_id,new.product_id,new.quality_id,-coalesce(new.sack_count,0),'transfer',new.transfer_id,new.id);
   perform public.post_stock_sacks(parent.organization_id,parent.to_center_id,parent.to_location_id,new.product_id,new.quality_id,coalesce(new.sack_count,0),'transfer',new.transfer_id,new.id);
 end if; return new;
end $$;
revoke all on function public.post_line_sacks() from public,anon,authenticated;
create trigger post_sale_sacks after insert on public.sales_order_lines for each row execute function public.post_line_sacks();
create trigger post_purchase_sacks after update of sack_count on public.purchase_order_lines for each row execute function public.post_line_sacks();
create trigger post_transfer_sacks after insert on public.stock_transfer_lines for each row execute function public.post_line_sacks();
create trigger post_scrap_sacks after insert on public.stock_scrap_lines for each row execute function public.post_line_sacks();

create function public.purchase_sack_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.sack_count>0 and new.sack_count<>old.sack_count and exists(select 1 from public.purchase_orders where id=new.purchase_order_id and status='confirmed') then raise exception 'Confirmed sack counts cannot be changed; use a stock adjustment'; end if;
 return new;
end $$;
revoke all on function public.purchase_sack_snapshot() from public,anon,authenticated;
create trigger purchase_sack_snapshot before update of sack_count on public.purchase_order_lines for each row execute function public.purchase_sack_snapshot();

create function public.validate_purchase_sacks() returns trigger language plpgsql security definer set search_path=public as $$
declare line record; parent record; begin
 if exists(select 1 from public.purchase_orders o join public.purchase_order_lines l on l.purchase_order_id=o.id join public.products p on p.id=l.product_id where o.id=new.id and o.status='confirmed' and p.tracks_sacks and l.sack_count<=0) then raise exception 'Sack-tracked products require a detailed purchase and positive sack counts'; end if;
 select * into parent from public.purchase_orders where id=new.id and status='confirmed';
 if found then
  for line in select * from public.purchase_order_lines where purchase_order_id=new.id and sack_count>0 loop
   perform public.post_stock_sacks(parent.organization_id,parent.center_id,line.location_id,line.product_id,line.quality_id,line.sack_count,'purchase',parent.id,line.id);
  end loop;
 end if;
 return null;
end $$;
revoke all on function public.validate_purchase_sacks() from public,anon,authenticated;
create constraint trigger purchase_requires_sacks after insert or update of status on public.purchase_orders deferrable initially deferred for each row execute function public.validate_purchase_sacks();

-- Keep original business guards, financial posting and idempotency intact.
do $$ declare definition text; signature text; marker text; replacement text; begin
 for signature,marker,replacement in select * from (values
 ('public.confirm_center_sale(uuid,uuid,uuid,text,jsonb,jsonb)','insert into public.sales_order_lines','perform set_config(''centerpro.sack_line'',v_line::text,true); insert into public.sales_order_lines'),
 ('public.create_stock_transfer(uuid,uuid,uuid,uuid,uuid,jsonb,text)','insert into public.stock_transfer_lines','perform set_config(''centerpro.sack_line'',p_lines::text,true); insert into public.stock_transfer_lines'),
 ('public.request_bill_return(text,uuid,text,jsonb)','insert into public.bill_return_lines','perform set_config(''centerpro.sack_line'',v_line::text,true); insert into public.bill_return_lines'),
 ('public.create_stock_scrap(uuid,uuid,uuid,jsonb,text)','insert into public.stock_scrap_lines','perform set_config(''centerpro.sack_line'',p_lines::text,true); insert into public.stock_scrap_lines'),
 ('public.confirm_queued_purchase_detailed(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,boolean)','(value->>''sack_count'')::integer <= 0','(value->>''sack_count'')::integer < 0')
 ) as edits(signature,marker,replacement) loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(marker in definition)=0 then raise exception 'Sack integration marker missing: %',signature; end if;
  execute replace(definition,marker,replacement);
 end loop;
end $$;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.stock_scrap_balances()'::regprocedure);
 definition:=replace(definition,'''value'',g.value)',
 '''value'',g.value,''tracksSacks'',(select tracks_sacks from public.products where id=g.product_id),''sacks'',(select coalesce(sum(delta),0) from public.stock_sack_movements where center_id=g.center_id and location_id=g.location_id and product_id=g.product_id and quality_id=g.quality_id))');
 execute definition;
end $$;

-- Sack-only physical counts use the same locked adjustment RPC. The extra
-- argument is optional for older non-tracked clients.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.create_stock_adjustment(uuid,uuid,uuid,uuid,uuid,numeric,numeric,text)'::regprocedure);
 definition:=replace(definition,'p_reason text)','p_reason text, p_counted_sacks integer DEFAULT NULL)');
 definition:=replace(definition,'delta:=p_counted-available;', $body$
 if (select tracks_sacks from public.products where id=p_product) and p_counted_sacks is null then raise exception 'Enter the physically counted sacks'; end if;
 if p_counted_sacks<0 then raise exception 'Counted sacks cannot be negative'; end if;
 delta:=p_counted-available;
 $body$);
 definition:=replace(definition,'if delta=0 then raise exception ''Counted quantity matches system stock; no adjustment needed''; end if;',
 'if delta=0 and p_counted_sacks is null then raise exception ''Counted quantity matches system stock; no adjustment needed''; end if;');
 -- The count fields must be present at insert time for sack-only differences.
 definition:=replace(definition,'unit_cost,reason,created_by)', 'unit_cost,reason,created_by,previous_sacks,counted_sacks)');
 definition:=replace(definition,'cost,trim(p_reason),auth.uid()) returning id', 'cost,trim(p_reason),auth.uid(),(select coalesce(sum(sm.delta),0) from public.stock_sack_movements sm where center_id=p_center and location_id=p_location and product_id=p_product and quality_id=p_quality),p_counted_sacks) returning id');
 definition:=replace(definition,'insert into public.stock_movements(', 'if delta<>0 then insert into public.stock_movements(');
 definition:=replace(definition,'insert into public.audit_logs(', $body$
 end if;
 if p_counted_sacks is not null then
  perform public.post_stock_sacks(org_id,p_center,p_location,p_product,p_quality,p_counted_sacks-(select coalesce(sum(sm.delta),0)::integer from public.stock_sack_movements sm where center_id=p_center and location_id=p_location and product_id=p_product and quality_id=p_quality),'adjustment',adjustment_id,adjustment_id);
 end if;
 insert into public.audit_logs(
 $body$);
 execute definition;
end $$;
revoke all on function public.create_stock_adjustment(uuid,uuid,uuid,uuid,uuid,numeric,numeric,text,integer) from public,anon;
grant execute on function public.create_stock_adjustment(uuid,uuid,uuid,uuid,uuid,numeric,numeric,text,integer) to authenticated;
-- Avoid ambiguous optional overloads; all older calls resolve to the new default.
drop function public.create_stock_adjustment(uuid,uuid,uuid,uuid,uuid,numeric,numeric,text);

create function public.reverse_bill_sacks() returns trigger language plpgsql security definer set search_path=public as $$
declare line record; kind text; begin
 if new.status=old.status then return new; end if;
 if tg_table_name='bill_returns' and new.status::text='approved' then
  for line in select * from public.bill_return_lines where return_id=new.id loop
   perform public.post_stock_sacks(new.organization_id,new.center_id,line.location_id,line.product_id,line.quality_id,case when new.bill_type='sale' then coalesce(line.sack_count,0) else -coalesce(line.sack_count,0) end,'return',new.id,line.id);
  end loop;
 elsif tg_table_name in ('sales_orders','purchase_orders') and new.status::text='cancelled' then
  kind:=case when tg_table_name='sales_orders' then 'sale' else 'purchase' end;
  for line in select * from public.stock_sack_movements where reference_type=kind and reference_id=new.id loop
   perform public.post_stock_sacks(line.organization_id,line.center_id,line.location_id,line.product_id,line.quality_id,-line.delta,'cancellation',new.id,line.source_line_id);
  end loop;
 end if; return new;
end $$;
revoke all on function public.reverse_bill_sacks() from public,anon,authenticated;
create trigger reverse_sale_sacks after update of status on public.sales_orders for each row execute function public.reverse_bill_sacks();
create trigger reverse_purchase_sacks after update of status on public.purchase_orders for each row execute function public.reverse_bill_sacks();
create trigger return_sacks after update of status on public.bill_returns for each row execute function public.reverse_bill_sacks();
commit;
