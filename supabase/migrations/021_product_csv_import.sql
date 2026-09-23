-- Atomically import a reviewed CSV batch. The authenticated caller must be an admin.
create or replace function public.import_products(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row jsonb;
  v_number integer := 0;
  v_code text;
  v_name text;
  v_category_code text;
  v_category_name text;
  v_unit text;
  v_price_text text;
  v_category_id uuid;
  v_existing_category_name text;
  v_product_id uuid;
  v_codes text[] := array[]::text[];
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  select organization_id into v_org from public.profiles where id = auth.uid() and is_active;
  if v_org is null then raise exception 'Active admin profile required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Import between 1 and 500 products per batch';
  end if;

  -- Prevent simultaneous imports into the same organization from racing.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 0));
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_number := v_number + 1;
    if jsonb_typeof(v_row) <> 'object' then raise exception 'Row %: invalid product', v_number; end if;
    v_code := upper(btrim(v_row->>'code'));
    v_name := btrim(v_row->>'name');
    v_category_code := upper(btrim(coalesce(v_row->>'category_code', '')));
    v_category_name := btrim(coalesce(v_row->>'category_name', ''));
    v_unit := upper(btrim(coalesce(v_row->>'unit', '')));
    v_price_text := btrim(coalesce(v_row->>'global_price', ''));
    if v_code is null or v_code = '' or length(v_code) > 50 or v_name is null or v_name = '' or length(v_name) > 200 then
      raise exception 'Row %: product code/name required (max 50/200 characters)', v_number;
    end if;
    if v_code = any(v_codes) then raise exception 'Row %: duplicate product code % in file', v_number, v_code; end if;
    v_codes := array_append(v_codes, v_code);
    if v_unit not in ('KG','G','UNIT') then raise exception 'Row %: unit must be KG, G or UNIT', v_number; end if;
    if (v_category_code = '') <> (v_category_name = '') or length(v_category_code) > 50 or length(v_category_name) > 200 then
      raise exception 'Row %: supply both category code and name, or leave both blank', v_number;
    end if;
    if v_price_text !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' then
      raise exception 'Row %: invalid global purchase price', v_number;
    end if;
    if exists (select 1 from public.products where organization_id = v_org and code = v_code) then
      raise exception 'Row %: product code % already exists', v_number, v_code;
    end if;
    if v_category_code <> '' then
      select name into v_existing_category_name from public.product_categories
      where organization_id = v_org and code = v_category_code;
      if v_existing_category_name is not null and lower(v_existing_category_name) <> lower(v_category_name) then
        raise exception 'Row %: category code % already belongs to %', v_number, v_category_code, v_existing_category_name;
      end if;
      if exists (select 1 from public.product_categories where organization_id=v_org
        and lower(name)=lower(v_category_name) and code<>v_category_code) then
        raise exception 'Row %: category name % already has a different code', v_number, v_category_name;
      end if;
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_code := upper(btrim(v_row->>'code'));
    v_name := btrim(v_row->>'name');
    v_category_code := upper(btrim(coalesce(v_row->>'category_code', '')));
    v_category_name := btrim(coalesce(v_row->>'category_name', ''));
    v_category_id := null;
    if v_category_code <> '' then
      insert into public.product_categories(organization_id,code,name)
      values(v_org,v_category_code,v_category_name)
      on conflict (organization_id,code) do nothing;
      select id into v_category_id from public.product_categories
      where organization_id=v_org and code=v_category_code and is_active;
      if v_category_id is null then raise exception 'Category % is inactive', v_category_code; end if;
    end if;
    insert into public.products(organization_id,code,name,category,category_id,unit_of_measure)
    values(v_org,v_code,v_name,nullif(v_category_name,''),v_category_id,upper(btrim(v_row->>'unit')))
    returning id into v_product_id;
    insert into public.product_qualities(product_id,name,description,default_price,is_base)
    values(v_product_id,'Standard','Base product price',(v_row->>'global_price')::numeric,true);
  end loop;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(v_org,auth.uid(),'products_imported','products',v_org::text,jsonb_build_object('count',v_number));
  return v_number;
end;
$$;

revoke all on function public.import_products(jsonb) from public;
grant execute on function public.import_products(jsonb) to authenticated;
