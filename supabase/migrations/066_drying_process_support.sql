begin;

-- Add Drying as a first-class manufacturing process. The existing BOM, order,
-- stock movement, lot valuation and operation-cost engines remain shared.
alter table public.manufacturing_recipes
  drop constraint if exists manufacturing_recipes_process_type_check;
alter table public.manufacturing_recipes
  add constraint manufacturing_recipes_process_type_check
  check (process_type = any (array['milling'::text, 'drying'::text, 'packing'::text]));

alter table public.manufacturing_orders
  drop constraint if exists manufacturing_orders_process_type_check;
alter table public.manufacturing_orders
  add constraint manufacturing_orders_process_type_check
  check (process_type = any (array['milling'::text, 'drying'::text, 'packing'::text]));

do $drying$
declare
  definition text;
  marker text;
  replacement text;
begin
  -- Extend the structured BoM save function with Drying-specific boundaries.
  definition := pg_get_functiondef('public.save_manufacturing_bom(uuid,jsonb)'::regprocedure);

  marker := 'process:=p_data->>''process_type'';if process not in (''milling'',''packing'') then raise exception ''Valid BoM process required'';end if;';
  if position(marker in definition)=0 or length(definition)-length(replace(definition,marker,''))<>length(marker) then
    raise exception 'Drying migration: process validation marker missing or ambiguous in save_manufacturing_bom';
  end if;
  replacement := 'process:=p_data->>''process_type'';if process not in (''milling'',''drying'',''packing'') then raise exception ''Valid BoM process required'';end if;';
  definition := replace(definition,marker,replacement);

  marker := 'if fg.id is null or q.id is null then raise exception ''Active manufacturable finished product and quality required'';end if;';
  if position(marker in definition)=0 or length(definition)-length(replace(definition,marker,''))<>length(marker) then
    raise exception 'Drying migration: finished-product validation marker missing or ambiguous';
  end if;
  replacement := marker || E'\n if process=''drying'' and (fg.unit_of_measure not in (''KG'',''G'') or jsonb_array_length(p_data->''byproducts'')>0) then raise exception ''Drying requires a weight-based finished product and no by-products'';end if;';
  definition := replace(definition,marker,replacement);

  marker := 'if (process=''milling'' and row->>''input_kind''<>''raw_material'') or (process=''packing'' and row->>''input_kind'' not in (''bulk_rice'',''packaging'')) then raise exception ''Invalid component kind for this process'';end if;';
  if position(marker in definition)=0 or length(definition)-length(replace(definition,marker,''))<>length(marker) then
    raise exception 'Drying migration: component-kind validation marker missing or ambiguous';
  end if;
  replacement := 'if (process in (''milling'',''drying'') and row->>''input_kind''<>''raw_material'') or (process=''packing'' and row->>''input_kind'' not in (''bulk_rice'',''packaging'')) then raise exception ''Invalid component kind for this process'';end if;' ||
    E'\n  if process=''drying'' and p.unit_of_measure not in (''KG'',''G'') then raise exception ''Drying components must use KG or G units'';end if;';
  definition := replace(definition,marker,replacement);

  execute definition;

  -- Only Milling supports the external mill method; Drying is an in-house
  -- conversion with the same configurable operation/labor costing as Milling.
  definition := pg_get_functiondef('public.save_bom_manufacturing_order(uuid,jsonb)'::regprocedure);
  marker := 'v_method:=coalesce(p_data->>''method'',''own'');if v_method not in (''own'',''external'') or (doc->>''process_type''=''packing'' and v_method<>''own'') then raise exception ''Invalid production method'';end if;';
  if position(marker in definition)=0 or length(definition)-length(replace(definition,marker,''))<>length(marker) then
    raise exception 'Drying migration: order method validation marker missing or ambiguous in save_bom_manufacturing_order';
  end if;
  replacement := 'v_method:=coalesce(p_data->>''method'',''own'');if v_method not in (''own'',''external'') or (doc->>''process_type'' in (''packing'',''drying'') and v_method<>''own'') then raise exception ''Only Milling supports external processing'';end if;';
  definition := replace(definition,marker,replacement);
  execute definition;

  -- Drying is mass-conversion: raw paddy weight must not be lower than the
  -- accepted dry-paddy output weight. The difference is recorded as process loss.
  definition := pg_get_functiondef('public.complete_manufacturing_order(uuid)'::regprocedure);

  marker := 'elsif exists(select 1 from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.input_kind<>''raw_material'') then raise exception ''Milling inputs must be raw materials'';end if;';
  if position(marker in definition)=0 or length(definition)-length(replace(definition,marker,''))<>length(marker) then
    raise exception 'Drying migration: non-packing input validation marker missing or ambiguous in complete_manufacturing_order';
  end if;
  replacement := 'elsif exists(select 1 from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.input_kind<>''raw_material'') then raise exception ''Milling and Drying inputs must be raw materials'';end if;';
  definition := replace(definition,marker,replacement);

  marker := 'into v_weight,v_shares,v_count from public.manufacturing_order_outputs x where x.order_id=v_order.id and x.quantity>0;';
  if position(marker in definition)=0 or length(definition)-length(replace(definition,marker,''))<>length(marker) then
    raise exception 'Drying migration: output weight aggregation marker missing or ambiguous';
  end if;
  replacement := marker || E'\n if v_order.process_type=''drying'' and v_weight>v_input then raise exception ''Drying output cannot exceed the accepted raw input weight'';end if;';
  definition := replace(definition,marker,replacement);

  marker := 'process_loss_kg=case when v_order.bom_snapshot is not null and v_order.process_type=''packing'' then greatest(0,v_input-v_weight) else 0 end,';
  if position(marker in definition)=0 or length(definition)-length(replace(definition,marker,''))<>length(marker) then
    raise exception 'Drying migration: process-loss marker missing or ambiguous';
  end if;
  replacement := 'process_loss_kg=case when v_order.bom_snapshot is not null and v_order.process_type in (''packing'',''drying'') then greatest(0,v_input-v_weight) else 0 end,';
  definition := replace(definition,marker,replacement);

  execute definition;
end
$drying$;

notify pgrst, 'reload schema';
commit;
