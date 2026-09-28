begin;

create sequence public.stock_scrap_number_seq;

create table public.stock_scraps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  organization_id uuid not null references public.organizations(id),
  scrap_number text not null unique,
  center_id uuid not null references public.centers(id),
  location_id uuid not null references public.locations(id),
  center_label text not null,
  location_label text not null,
  reason text not null check (length(trim(reason)) between 2 and 500),
  total_quantity numeric(18,3) not null default 0 check (total_quantity > 0),
  total_value numeric(18,2) not null default 0 check (total_value >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index stock_scraps_org_date on public.stock_scraps(organization_id, created_at desc);
create index stock_scraps_center_date on public.stock_scraps(center_id, created_at desc);

create table public.stock_scrap_lines (
  id uuid primary key default gen_random_uuid(),
  scrap_id uuid not null references public.stock_scraps(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quality_id uuid not null references public.product_qualities(id),
  product_code text not null,
  product_name text not null,
  quality_name text not null,
  unit text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_cost numeric(18,2) not null check (unit_cost >= 0),
  line_value numeric(18,2) not null check (line_value >= 0),
  created_at timestamptz not null default now(),
  unique (scrap_id, product_id, quality_id)
);

alter table public.stock_scraps enable row level security;
alter table public.stock_scrap_lines enable row level security;

create policy stock_scraps_read on public.stock_scraps for select using (
  organization_id=(public.current_profile()).organization_id
  and (public.has_permission('stock') or (public.current_profile()).role='center_user')
  and public.can_access_center(center_id)
);
create policy stock_scrap_lines_read on public.stock_scrap_lines for select using (
  exists (
    select 1 from public.stock_scraps s
    where s.id=scrap_id
      and s.organization_id=(public.current_profile()).organization_id
      and (public.has_permission('stock') or (public.current_profile()).role='center_user')
      and public.can_access_center(s.center_id)
  )
);
grant select on public.stock_scraps, public.stock_scrap_lines to authenticated;

create function public.create_stock_scrap(
  p_request uuid,
  p_center uuid,
  p_location uuid,
  p_lines jsonb,
  p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  actor public.profiles%rowtype;
  org_id uuid;
  scrap_id uuid;
  scrap_no text;
  line jsonb;
  v_product_id uuid;
  v_quality_id uuid;
  qty numeric;
  available numeric;
  stock_value numeric;
  cost numeric;
  product_code text;
  product_name text;
  quality_name text;
  unit_name text;
  center_label text;
  location_label text;
  sum_qty numeric(18,3):=0;
  sum_value numeric(18,2):=0;
begin
  select * into actor from public.profiles where id=auth.uid() and is_active;
  if not found then raise exception 'Active account required'; end if;
  if actor.role<>'center_user' and not public.has_permission('stock') then raise exception 'Stock access required'; end if;
  if p_request is null then raise exception 'Scrap request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select id into scrap_id from public.stock_scraps where request_id=p_request and created_by=auth.uid();
  if scrap_id is not null then return scrap_id; end if;
  if p_center is null or p_location is null then raise exception 'Choose a center and location'; end if;
  if length(trim(coalesce(p_reason,'')))<2 or length(trim(p_reason))>500 then raise exception 'Enter a scrap reason (2 to 500 characters)'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception 'Choose at least one item to scrap'; end if;
  if not public.can_access_center(p_center) then raise exception 'You do not have access to this center'; end if;

  perform id from public.centers where id=p_center for update;
  select c.organization_id,c.code||' · '||c.name,l.code||' · '||l.name
    into org_id,center_label,location_label
    from public.centers c join public.locations l on l.center_id=c.id
    where c.id=p_center and l.id=p_location and c.is_active and l.is_active;
  if org_id is null or org_id<>actor.organization_id then raise exception 'Center or location is unavailable'; end if;

  scrap_no:='SC-'||to_char(now() at time zone 'Asia/Colombo','YYYYMMDD')||'-'||lpad(nextval('public.stock_scrap_number_seq')::text,6,'0');
  insert into public.stock_scraps(request_id,organization_id,scrap_number,center_id,location_id,center_label,location_label,reason,created_by)
    values(p_request,org_id,scrap_no,p_center,p_location,center_label,location_label,trim(p_reason),auth.uid()) returning id into scrap_id;

  for line in
    select jsonb_build_object('product_id',x->>'product_id','quality_id',x->>'quality_id','quantity',sum((x->>'quantity')::numeric))
    from jsonb_array_elements(p_lines) as items(x)
    group by x->>'product_id',x->>'quality_id'
  loop
    v_product_id:=(line->>'product_id')::uuid;
    v_quality_id:=(line->>'quality_id')::uuid;
    qty:=(line->>'quantity')::numeric;
    if qty is null or qty<=0 or qty<>round(qty,3) then raise exception 'Scrap quantity must be positive, with at most 3 decimals'; end if;

    select p.code,p.name,q.name,p.unit_of_measure into product_code,product_name,quality_name,unit_name
      from public.products p join public.product_qualities q on q.product_id=p.id
      where p.id=v_product_id and q.id=v_quality_id and p.organization_id=org_id and p.is_active and q.is_active;
    if product_name is null then raise exception 'Selected product or quality is unavailable'; end if;

    select coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity else -quantity end),0),
           coalesce(sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then quantity*unit_cost else -quantity*unit_cost end),0)
      into available,stock_value from public.stock_movements
      where center_id=p_center and location_id=p_location and stock_movements.product_id=v_product_id and stock_movements.quality_id=v_quality_id;
    if available<qty then raise exception 'Not enough stock to scrap % · % (available: % %)',product_name,quality_name,available,unit_name; end if;
    cost:=greatest(0,round(stock_value/nullif(available,0),2));

    insert into public.stock_scrap_lines(scrap_id,product_id,quality_id,product_code,product_name,quality_name,unit,quantity,unit_cost,line_value)
      values(scrap_id,v_product_id,v_quality_id,product_code,product_name,quality_name,unit_name,qty,cost,round(qty*cost,2));
    insert into public.stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
      values(org_id,p_center,p_location,v_product_id,v_quality_id,'adjustment_out',qty,cost,'stock_scrap',scrap_id,auth.uid());
    sum_qty:=sum_qty+qty;
    sum_value:=sum_value+round(qty*cost,2);
  end loop;
  if sum_qty<=0 then raise exception 'Enter a scrap quantity'; end if;
  update public.stock_scraps set total_quantity=sum_qty,total_value=sum_value where id=scrap_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
    values(org_id,auth.uid(),'stock_scrapped','stock_scrap',scrap_id::text,
      jsonb_build_object('scrap_number',scrap_no,'center',center_label,'location',location_label,'reason',trim(p_reason),'total_quantity',sum_qty,'total_value',sum_value,'lines',p_lines));
  return scrap_id;
end $$;

revoke all on function public.create_stock_scrap(uuid,uuid,uuid,jsonb,text) from public;
grant execute on function public.create_stock_scrap(uuid,uuid,uuid,jsonb,text) to authenticated;

commit;
