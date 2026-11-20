begin;

-- Keep Packing's explicit-source rule and all other completion checks intact.
do $$ declare definition text; marker text; begin
 definition:=pg_get_functiondef('public.prepare_bom_completion(uuid)'::regprocedure);
 marker:='if exists(select 1 from public.manufacturing_order_inputs i join public.products p on p.id=i.product_id where i.order_id=o.id and i.quantity>0 and p.tracks_purchase_lots and i.source_selection=''auto'') then';
 if position(marker in definition)=0 then raise exception 'BoM source validation marker missing';end if;
 definition:=replace(definition,marker,replace(marker,'if exists','if o.process_type<>''milling'' and exists'));
 execute definition;

 -- The immutable snapshot array is the same order used by the Milling preview.
 -- Leave legacy orders and Packing in their existing processing order.
 definition:=pg_get_functiondef('public.complete_manufacturing_order(uuid)'::regprocedure);
 marker:='for item in select i.* from public.manufacturing_order_inputs i where i.order_id=v_order.id and i.quantity>0 order by i.created_at,i.id loop';
 if position(marker in definition)=0 then raise exception 'Production component ordering marker missing';end if;
 definition:=replace(definition,marker,$code$
 for item in select i.* from public.manufacturing_order_inputs i
 where i.order_id=v_order.id and i.quantity>0
 order by case when v_order.process_type='milling' and v_order.bom_snapshot is not null then
  (select c.ordinality from jsonb_array_elements(v_order.bom_snapshot->'manufacturing_bom_components') with ordinality c(component,ordinality)
   where c.component->>'id'=i.bom_component_key::text)
 end,i.created_at,i.id loop
 $code$);
 execute definition;
end $$;

notify pgrst,'reload schema';
commit;
