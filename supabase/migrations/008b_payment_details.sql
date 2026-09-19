create table if not exists public.payment_banks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(organization_id,code),
  unique(organization_id,name)
);

alter table public.payment_banks enable row level security;
create policy "org reads payment banks" on public.payment_banks for select
  using (organization_id=(public.current_profile()).organization_id);
create policy "admins manage payment banks" on public.payment_banks for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.payment_banks(organization_id,code,name)
select o.id,b.code,b.name from public.organizations o cross join (values
 ('BOC','Bank of Ceylon'),('PEOPLES','People''s Bank'),('COMMERCIAL','Commercial Bank'),
 ('HNB','Hatton National Bank'),('SAMPATH','Sampath Bank'),('SEYLAN','Seylan Bank'),
 ('NDB','NDB Bank'),('DFCC','DFCC Bank'),('NSB','National Savings Bank'),
 ('NTB','Nations Trust Bank'),('PANASIA','Pan Asia Bank'),('UNION','Union Bank'),
 ('CARGILLS','Cargills Bank'),('AMANA','Amana Bank')
) as b(code,name) on conflict do nothing;

alter table public.purchase_orders
  add column if not exists bank_id uuid references public.payment_banks(id),
  add column if not exists cheque_number text,
  add column if not exists cheque_bank_code text,
  add column if not exists cheque_branch_code text,
  add column if not exists cheque_date date,
  add column if not exists payment_status text not null default 'paid'
    check(payment_status in ('paid','unpaid','partially_paid'));

alter table public.payments
  add column if not exists bank_id uuid references public.payment_banks(id),
  add column if not exists cheque_number text,
  add column if not exists bank_code text,
  add column if not exists branch_code text;

drop function if exists public.create_and_confirm_purchase(uuid,uuid,public.payment_method,text,text,jsonb);
create function public.create_and_confirm_purchase(
  target_center uuid,target_supplier uuid,selected_payment public.payment_method,
  payment_ref text,purchase_notes text,purchase_lines jsonb,
  selected_bank uuid default null,selected_cheque_number text default null,
  selected_bank_code text default null,selected_branch_code text default null,
  selected_cheque_date date default null
)
returns table(purchase_id uuid,purchase_number text,purchase_total numeric)
language plpgsql security definer set search_path=public as $$
declare v_org_id uuid;v_po_id uuid;v_po_number text;v_item jsonb;v_product_id uuid;v_quality_id uuid;v_location_id uuid;v_quantity numeric;v_actual_price numeric;v_system_price numeric;v_total numeric;
begin
 if not public.can_access_center(target_center) then raise exception 'Access denied for this center';end if;
 select c.organization_id into v_org_id from public.centers c where c.id=target_center and c.is_active;
 if v_org_id is null or v_org_id<>(public.current_profile()).organization_id then raise exception 'Invalid center';end if;
 if not exists(select 1 from public.suppliers s where s.id=target_supplier and s.organization_id=v_org_id and s.is_active) then raise exception 'Invalid supplier';end if;
 if jsonb_typeof(purchase_lines)<>'array' or jsonb_array_length(purchase_lines)=0 then raise exception 'At least one purchase line is required';end if;
 if selected_payment in ('bank_transfer','card','cheque') and (selected_bank is null or not exists(select 1 from public.payment_banks b where b.id=selected_bank and b.organization_id=v_org_id and b.is_active)) then raise exception 'Select a valid bank';end if;
 if selected_payment='cheque' and (nullif(trim(selected_cheque_number),'') is null or nullif(trim(selected_bank_code),'') is null or nullif(trim(selected_branch_code),'') is null or selected_cheque_date is null) then raise exception 'Cheque number, bank code, branch code and cheque date are required';end if;
 v_po_number:='PO-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_order_number_seq')::text,5,'0');
 insert into public.purchase_orders(organization_id,center_id,supplier_id,po_number,payment_method,payment_reference,notes,created_by,bank_id,cheque_number,cheque_bank_code,cheque_branch_code,cheque_date,payment_status)
 values(v_org_id,target_center,target_supplier,v_po_number,selected_payment,nullif(trim(payment_ref),''),nullif(trim(purchase_notes),''),auth.uid(),selected_bank,nullif(trim(selected_cheque_number),''),nullif(trim(selected_bank_code),''),nullif(trim(selected_branch_code),''),selected_cheque_date,case when selected_payment='credit' then 'unpaid' else 'paid' end) returning id into v_po_id;
 for v_item in select value from jsonb_array_elements(purchase_lines) loop
  v_product_id:=(v_item->>'product_id')::uuid;v_quality_id:=(v_item->>'quality_id')::uuid;v_location_id:=nullif(v_item->>'location_id','')::uuid;v_quantity:=(v_item->>'quantity')::numeric;v_actual_price:=(v_item->>'actual_price')::numeric;
  if v_quantity<=0 then raise exception 'Every quantity must be greater than zero';end if;if v_actual_price<0 then raise exception 'Purchase price cannot be negative';end if;
  select coalesce(cp.price,q.default_price) into v_system_price from public.product_qualities q join public.products p on p.id=q.product_id left join public.center_prices cp on cp.center_id=target_center and cp.quality_id=q.id where q.id=v_quality_id and q.product_id=v_product_id and p.organization_id=v_org_id and p.is_active and q.is_active;
  if v_system_price is null then raise exception 'Invalid product or quality';end if;
  insert into public.purchase_order_lines(purchase_order_id,product_id,quality_id,location_id,quantity,system_price,actual_price) values(v_po_id,v_product_id,v_quality_id,v_location_id,v_quantity,v_system_price,v_actual_price);
 end loop;
 perform public.confirm_purchase(v_po_id);select po.total_amount into v_total from public.purchase_orders po where po.id=v_po_id;return query select v_po_id,v_po_number,v_total;
end $$;

create or replace function public.confirm_purchase(target_po uuid)
returns void language plpgsql security definer set search_path=public as $$
declare po public.purchase_orders%rowtype;line public.purchase_order_lines%rowtype;center_row public.centers%rowtype;default_location uuid;computed_total numeric(18,2);
begin
 select * into po from public.purchase_orders where id=target_po for update;if not found then raise exception 'Purchase order not found';end if;if not public.can_access_center(po.center_id) then raise exception 'Access denied';end if;if po.status<>'draft' then raise exception 'Only draft purchases can be confirmed';end if;
 select * into center_row from public.centers where id=po.center_id;select id into default_location from public.locations where center_id=po.center_id and is_default and is_active;if default_location is null then raise exception 'Center requires an active default location';end if;if not exists(select 1 from public.purchase_order_lines pol where pol.purchase_order_id=po.id) then raise exception 'At least one purchase line is required';end if;
 for line in select * from public.purchase_order_lines pol where pol.purchase_order_id=po.id loop
  if center_row.allow_multiple_locations and line.location_id is null then raise exception 'Location is required for every purchase line at this center';end if;
  if line.location_id is not null and not exists(select 1 from public.locations l where l.id=line.location_id and l.center_id=po.center_id and l.is_active) then raise exception 'Selected location does not belong to this center';end if;
  if not exists(select 1 from public.product_qualities q where q.id=line.quality_id and q.product_id=line.product_id) then raise exception 'Selected quality does not belong to the product';end if;
 end loop;
 select round(sum(pol.line_total),2) into computed_total from public.purchase_order_lines pol where pol.purchase_order_id=po.id;
 if po.payment_method='cash' and public.center_cash_balance(po.center_id)<computed_total then raise exception 'Insufficient center cash balance';end if;
 update public.purchase_order_lines set location_id=default_location where purchase_order_id=po.id and location_id is null;
 update public.purchase_orders set status='confirmed',total_amount=computed_total,confirmed_at=now(),confirmed_by=auth.uid(),updated_at=now() where id=po.id;
 insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) select po.organization_id,po.center_id,l.location_id,l.product_id,l.quality_id,'purchase_in',l.quantity,l.actual_price,'purchase_order',po.id,auth.uid() from public.purchase_order_lines l where l.purchase_order_id=po.id;
 if po.payment_method<>'credit' then insert into public.payments(organization_id,center_id,purchase_order_id,method,amount,reference,cheque_number,cheque_date,created_by,bank_id,bank_code,branch_code) values(po.organization_id,po.center_id,po.id,po.payment_method,computed_total,po.payment_reference,po.cheque_number,po.cheque_date,auth.uid(),po.bank_id,po.cheque_bank_code,po.cheque_branch_code);end if;
 if po.payment_method='cash' then insert into public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by) values(po.organization_id,po.center_id,'purchase',computed_total,'purchase_order',po.id,po.po_number,auth.uid());end if;
 insert into public.notifications(organization_id,type,title,message,center_id,reference_id) select po.organization_id,'price_override','Purchase price changed','One or more prices differ from the configured price on '||po.po_number,po.center_id,po.id where exists(select 1 from public.purchase_order_lines pol where pol.purchase_order_id=po.id and pol.actual_price<>pol.system_price);
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(po.organization_id,auth.uid(),'purchase_confirmed','purchase_order',po.id::text,jsonb_build_object('po_number',po.po_number,'total',computed_total,'payment_method',po.payment_method,'payment_status',po.payment_status));
end $$;

grant execute on function public.create_and_confirm_purchase(uuid,uuid,public.payment_method,text,text,jsonb,uuid,text,text,text,date) to authenticated;
grant execute on function public.confirm_purchase(uuid) to authenticated;
