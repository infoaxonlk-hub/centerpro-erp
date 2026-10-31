export type BomComponent={id:string;product_id:string;quality_id:string;quantity:number|string;unit:string;input_kind:'raw_material'|'bulk_rice'|'packaging';sequence:number;product_name?:string;quality_name?:string};
export type BomByproduct={id:string;product_id:string;quality_id:string;quantity:number|string;unit:string;destination_center_id:string;destination_location_id:string;cost_share_percent:number|string;sequence:number;product_name?:string;quality_name?:string;destination_name?:string};
export type BomOperation={id:string;name:string;planned_quantity:number|string;cost_basis:'per_kg'|'per_hour'|'per_batch';cost_rate:number|string;sequence:number};
export type ManufacturingBom={id:string;recipe_code:string;name:string;process_type:'milling'|'packing';rice_variety:string;is_active:boolean;revision:number;
 finished_product_id:string|null;finished_quality_id:string|null;finished_quantity:number|string|null;finished_unit:string|null;finished_cost_share:number|string;
 production_center_id:string|null;source_location_id:string|null;destination_center_id:string|null;destination_location_id:string|null;package_size_kg:number|string|null;
 operation_name:string;operation_cost_basis:string;operation_cost_rate:number|string;external_mill_fee_per_kg:number|string;
 finished_product_name?:string;finished_quality_name?:string;source_name?:string;destination_name?:string;
 manufacturing_bom_components:BomComponent[];manufacturing_bom_byproducts:BomByproduct[];manufacturing_bom_operations:BomOperation[]};
export type BomActualInput={bom_component_key:string;product_id:string;quality_id:string;input_kind:BomComponent['input_kind'];unit:string;planned_quantity:number;quantity:number;source_selection:'auto'|'lot'|'legacy';lot_id:string|null;sack_count:number;lot_number?:string};
export type BomActualOutput={bom_output_key:string;product_id:string;quality_id:string;unit:string;planned_quantity:number;quantity:number;sack_count:number;destination_center_id:string;destination_location_id:string;cost_share_percent:number};
export type BomActualOperation={bom_operation_key:string;name:string;planned_quantity:number;actual_quantity:number;cost_basis:BomOperation['cost_basis'];cost_rate:number;line_cost?:number|string};
export const roundBom=(n:number,places=3)=>Math.round(n*10**places)/10**places;
export function millingInputComponents(bom:ManufacturingBom|null|undefined){
 return (bom?.manufacturing_bom_components??[]).filter(c=>c.input_kind==='raw_material'&&['KG','G'].includes(c.unit)&&Number.isFinite(Number(c.quantity))&&Number(c.quantity)>0).sort((a,b)=>(a.sequence??0)-(b.sequence??0)||a.id.localeCompare(b.id));
}
export function productionFromInputKg(bom:ManufacturingBom,componentId:string,inputKg:number){
 const component=millingInputComponents(bom).find(c=>c.id===componentId);
 if(bom.process_type!=='milling'||!component||!Number.isFinite(inputKg)||inputKg<=0||!Number.isFinite(Number(bom.finished_quantity))||Number(bom.finished_quantity)<=0)throw new Error('Choose a milling BoM, a weight-based raw component and a positive input quantity.');
 const baseKg=Number(component.quantity)*(component.unit==='G'?.001:1);
 const result=roundBom(inputKg/baseKg*Number(bom.finished_quantity));
 if(!Number.isFinite(result)||result<=0)throw new Error('Input quantity is too small or too large for this BoM.');
 return result;
}
export function scaleManufacturingBom(bom:ManufacturingBom,quantity:number){
 if(!bom.finished_product_id||!bom.finished_quality_id||!bom.production_center_id||!bom.source_location_id||!bom.destination_center_id||!bom.destination_location_id||!Number.isFinite(quantity)||quantity<=0||Number(bom.finished_quantity)<=0)throw new Error('Choose a complete BoM and a positive production quantity.');
 const factor=quantity/Number(bom.finished_quantity);
 const inputs:BomActualInput[]=bom.manufacturing_bom_components.map(c=>({bom_component_key:c.id,product_id:c.product_id,quality_id:c.quality_id,input_kind:c.input_kind,unit:c.unit,planned_quantity:roundBom(Number(c.quantity)*factor),quantity:roundBom(Number(c.quantity)*factor),source_selection:'auto',lot_id:null,sack_count:0}));
 const outputs:BomActualOutput[]=[{bom_output_key:'finished',product_id:bom.finished_product_id,quality_id:bom.finished_quality_id,unit:bom.finished_unit??'UNIT',planned_quantity:quantity,quantity,sack_count:0,destination_center_id:bom.destination_center_id,destination_location_id:bom.destination_location_id,cost_share_percent:Number(bom.finished_cost_share)},...bom.manufacturing_bom_byproducts.map(b=>({bom_output_key:b.id,product_id:b.product_id,quality_id:b.quality_id,unit:b.unit,planned_quantity:roundBom(Number(b.quantity)*factor),quantity:roundBom(Number(b.quantity)*factor),sack_count:0,destination_center_id:b.destination_center_id,destination_location_id:b.destination_location_id,cost_share_percent:Number(b.cost_share_percent)}))];
 const operations:BomActualOperation[]=bom.manufacturing_bom_operations.map(o=>({bom_operation_key:o.id,name:o.name,planned_quantity:roundBom(Number(o.planned_quantity)*factor,6),actual_quantity:roundBom(Number(o.planned_quantity)*factor,6),cost_basis:o.cost_basis,cost_rate:Number(o.cost_rate)}));
 return{inputs,outputs,operations};
}
export function actualComponentKg(inputs:readonly BomActualInput[]){return roundBom(inputs.filter(i=>i.input_kind!=='packaging').reduce((sum,i)=>sum+Number(i.quantity)*(i.unit==='G'?.001:1),0),6);}
