begin;

create sequence public.stock_transfer_number_seq;

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  organization_id uuid not null references public.organizations(id),
  transfer_number text not null unique,
  from_center_id uuid not null references public.centers(id),
  from_location_id uuid not null references public.locations(id),
  to_center_id uuid not null references public.centers(id),
  to_location_id uuid not null references public.locations(id),
  from_label text not null,
  to_label text not null,
  note text,
  total_quantity numeric(18,3) not null default 0 check(total_quantity>=0),
  total_value numeric(18,2) not null default 0 check(total_value>=0),
  status text not null default 'completed' check(status='completed'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check(from_center_id<>to_center_id or from_location_id<>to_location_id)
);
create index stock_transfers_org_date on public.stock_transfers(organization_id,created_at desc);
create index stock_transfers_from_center on public.stock_transfers(from_center_id,created_at desc);
create index stock_transfers_to_center on public.stock_transfers(to_center_id,created_at desc);

create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quality_id uuid not null references public.product_qualities(id),
  product_name text not null,
  quality_name text not null,
  unit text not null,
  quantity numeric(18,3) not null check(quantity>0),
  unit_cost numeric(18,2) not null check(unit_cost>=0),
  line_value numeric(18,2) not null check(line_value>=0),
  created_at timestamptz not null default now(),
  unique(transfer_id,product_id,quality_id)
);

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
create policy stock_transfers_read on public.stock_transfers for select using(
  organization_id=(public.current_profile()).organization_id and public.has_permission('stock') and
  (public.is_admin() or public.can_access_center(from_center_id) or public.can_access_center(to_center_id))
);
create policy stock_transfer_lines_read on public.stock_transfer_lines for select using(
  exists(select 1 from public.stock_transfers t where t.id=transfer_id and t.organization_id=(public.current_profile()).organization_id and public.has_permission('stock') and
  (public.is_admin() or public.can_access_center(t.from_center_id) or public.can_access_center(t.to_center_id)))
);
grant select on public.stock_transfers,public.stock_transfer_lines to authenticated;

create function public.create_stock_transfer(
  p_request uuid,
  p_from_center uuid,
  p_from_location uuid,
  p_to_center uuid,
  p_to_location uuid,
  p_lines jsonb,
  p_note text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_org uuid; v_transfer uuid; v_number text; v_line jsonb; v_product uuid; v_quality uuid;
  v_quantity numeric; v_available numeric; v_stock_value numeric; v_unit_cost numeric;
  v_product_name text; v_quality_name text; v_unit text; v_total_qty numeric(18,3):=0; v_total_value numeric(18,2):=0;
  v_from_label text; v_to_label text;
begin
  if not public.has_permission('stock') then raise exception 'Stock access required'; end if;
  if p_request is null then raise exception 'Transfer request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select id into v_transfer from public.stock_transfers where request_id=p_request and created_by=auth.uid();
  if v_transfer is not null then return v_transfer; end if;
  if p_from_center is null or p_to_center is null or p_from_location is null or p_to_location is null then raise exception 'Choose both centers and locations'; end if;
  if p_from_center=p_to_center and p_from_location=p_to_location then raise exception 'Source and destination must be different locations'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception 'Choose at least one inventory item'; end if;

  -- Serialize stock changes per center in a stable order to avoid overselling
  -- while sales, purchases, adjustments, or another transfer are posting.
  perform id from public.centers where id in (p_from_center,p_to_center) order by id for update;
  select c.organization_id into v_org from public.centers c where c.id=p_from_center and c.is_active;
  if v_org is null or v_org<>(public.current_profile()).organization_id then raise exception 'Source center is unavailable'; end if;
  if not exists(select 1 from public.centers c where c.id=p_to_center and c.organization_id=v_org and c.is_active) then raise exception 'Destination center is unavailable'; end if;
  if not public.can_access_center(p_from_center) or not public.can_access_center(p_to_center) then raise exception 'You do not have access to both centers'; end if;
  if not exists(select 1 from public.locations where id=p_from_location and center_id=p_from_center and is_active) then raise exception 'Choose an active source location'; end if;
  if not exists(select 1 from public.locations where id=p_to_location and center_id=p_to_center and is_active) then raise exception 'Choose an active destination location'; end if;
  select fc.code||' · '||fc.name||' / '||fl.code||' · '||fl.name,
         tc.code||' · '||tc.name||' / '||tl.code||' · '||tl.name
    into v_from_label,v_to_label
    from public.centers fc join public.locations fl on fl.id=p_from_location
    join public.centers tc on tc.id=p_to_center join public.locations tl on tl.id=p_to_location
    where fc.id=p_from_center;

  v_number:='TR-'||to_char(now() at time zone 'Asia/Colombo','YYYYMMDD')||'-'||lpad(nextval('public.stock_transfer_number_seq')::text,6,'0');
  insert into public.stock_transfers(request_id,organization_id,transfer_number,from_center_id,from_location_id,to_center_id,to_location_id,from_label,to_label,note,created_by)
  values(p_request,v_org,v_number,p_from_center,p_from_location,p_to_center,p_to_location,v_from_label,v_to_label,nullif(trim(p_note),''),auth.uid()) returning id into v_transfer;

  for v_line in
    select jsonb_build_object('product_id',x->>'product_id','quality_id',x->>'quality_id','quantity',sum((x->>'quantity')::numeric))
      from jsonb_array_elements(p_lines) as lines(x)
      group by x->>'product_id',x->>'quality_id'
  loop
    v_product:=(v_line->>'product_id')::uuid;
    v_quality:=(v_line->>'quality_id')::uuid;
    v_quantity:=(v_line->>'quantity')::numeric;
    if v_quantity is null or v_quantity<=0 or v_quantity<>round(v_quantity,3) then raise exception 'Transfer quantity must be positive, with at most 3 decimals'; end if;
    select p.name,q.name,p.unit_of_measure into v_product_name,v_quality_name,v_unit
      from public.products p join public.product_qualities q on q.product_id=p.id
      where p.id=v_product and q.id=v_quality and p.organization_id=v_org and p.is_active and q.is_active;
    if v_product_name is null then raise exception 'Selected product or quality is unavailable'; end if;

    select coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity else -quantity end),0),
           coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity*unit_cost else -quantity*unit_cost end),0)
      into v_available,v_stock_value from public.stock_movements
      where center_id=p_from_center and location_id=p_from_location and product_id=v_product and quality_id=v_quality;
    if v_available<v_quantity then raise exception 'Not enough stock for % · % (available: % %)',v_product_name,v_quality_name,v_available,v_unit; end if;
    v_unit_cost:=greatest(0,round(v_stock_value/nullif(v_available,0),2));
    insert into public.stock_transfer_lines(transfer_id,product_id,quality_id,product_name,quality_name,unit,quantity,unit_cost,line_value)
    values(v_transfer,v_product,v_quality,v_product_name,v_quality_name,v_unit,v_quantity,v_unit_cost,round(v_quantity*v_unit_cost,2));
    insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
    values(v_org,p_from_center,p_from_location,v_product,v_quality,'transfer_out',v_quantity,v_unit_cost,'stock_transfer',v_transfer,auth.uid());
    insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
    values(v_org,p_to_center,p_to_location,v_product,v_quality,'transfer_in',v_quantity,v_unit_cost,'stock_transfer',v_transfer,auth.uid());
    v_total_qty:=v_total_qty+v_quantity;
    v_total_value:=v_total_value+round(v_quantity*v_unit_cost,2);
  end loop;
  if v_total_qty<=0 then raise exception 'Transfer requires at least one valid line'; end if;
  update public.stock_transfers set total_quantity=v_total_qty,total_value=v_total_value where id=v_transfer;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(v_org,auth.uid(),'stock_transfer_completed','stock_transfer',v_transfer::text,jsonb_build_object('transfer_number',v_number,'from',v_from_label,'to',v_to_label,'total_quantity',v_total_qty,'total_value',v_total_value,'lines',p_lines));
  return v_transfer;
end $$;

revoke all on function public.create_stock_transfer(uuid,uuid,uuid,uuid,uuid,jsonb,text) from public;
grant execute on function public.create_stock_transfer(uuid,uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

commit;
