type Input={product_id:string;quality_id:string;lot_id?:string|null;quantity:string|number;source_selection?:string};
type Lot={center_id:string;location_id:string;product_id:string;quality_id:string;lot_id:string|null;lot_number?:string;available_quantity:string|number;inventory_value?:string|number;received_at?:string};
export type ProductionAllocation={lot_id:string|null;lot_number:string;quantity:number;inventory_value:number|null};
const round=(n:number)=>Math.round(n*1e6)/1e6;
// Compare instants, including offsets and fractional seconds, rather than timestamp strings.
function timestamp(value?:string){
 if(!value||value==='infinity')return Infinity;
 if(value==='-infinity')return -Infinity;
 const milliseconds=Date.parse(value);
 const fraction=value.match(/\.(\d+)/)?.[1]??'';
 return Number.isFinite(milliseconds)?milliseconds+Number('0.'+(fraction.slice(3)||'0')):Infinity;
}
function lotOrder(a:Lot,b:Lot){
 if(a.lot_id===null||b.lot_id===null)return a.lot_id===b.lot_id?0:a.lot_id===null?-1:1;
 const at=timestamp(a.received_at),bt=timestamp(b.received_at);
 return (at===bt?0:at<bt?-1:1)||(a.lot_id<b.lot_id?-1:a.lot_id>b.lot_id?1:0);
}
// One shared pool per source, depleted in component order. Database posting is authoritative.
export function productionAllocationPreview(inputs:readonly Input[],lots:readonly Lot[],center:string,location:string){
 const pools=lots.filter(l=>l.center_id===center&&l.location_id===location).map(l=>({...l,remaining:Math.max(0,Number(l.available_quantity)),value:l.inventory_value===undefined?null:Number(l.inventory_value)})).sort(lotOrder);
 return inputs.map(input=>{
  const matching=pools.filter(l=>l.product_id===input.product_id&&l.quality_id===input.quality_id&&(input.source_selection==='legacy'?l.lot_id===null:!input.lot_id||l.lot_id===input.lot_id));
  const available=round(matching.reduce((sum,l)=>sum+l.remaining,0)),required=Math.max(0,Number(input.quantity)||0);
  let need=required;
  const allocations:ProductionAllocation[]=[];
  for(const pool of matching){
   if(need<=0)break;if(pool.remaining<=0)continue;
   const take=Math.min(need,pool.remaining);
   const value=pool.value===null||!Number.isFinite(pool.value)?null:take===pool.remaining?pool.value:round(pool.value*take/pool.remaining);
   allocations.push({lot_id:pool.lot_id,lot_number:pool.lot_number??pool.lot_id??'Unassigned / Legacy',quantity:take,inventory_value:value});
   pool.remaining=round(pool.remaining-take);if(value!==null&&pool.value!==null)pool.value=round(pool.value-value);need=round(need-take);
  }
  return {available,required,remaining:round(Math.max(0,available-required)),shortage:round(Math.max(0,need)),allocations};
 });
}
export function productionStockPreview(inputs:readonly Input[],lots:readonly Lot[],center:string,location:string){
 return productionAllocationPreview(inputs,lots,center,location).map(({available,required,remaining,shortage})=>({available,required,remaining,shortage}));
}
// Missing cached valuation never falls back to product/default/selling prices.
export function productionMaterialPreview(inputs:readonly Input[],lots:readonly Lot[],center:string,location:string):number|null{
 const rows=productionAllocationPreview(inputs,lots,center,location);
 if(rows.some(r=>r.shortage>0||r.allocations.some(a=>a.inventory_value===null)))return null;
 return round(rows.reduce((sum,r)=>sum+r.allocations.reduce((v,a)=>v+(a.inventory_value??0),0),0));
}
