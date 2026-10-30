type Input={product_id:string;quality_id:string;lot_id?:string;quantity:string|number};
type Lot={center_id:string;location_id:string;product_id:string;quality_id:string;lot_id:string|null;available_quantity:string|number;inventory_value?:string|number;received_at?:string};
// Mirror physical oldest-lot consumption, including multiple input/package rows.
// Missing cached valuation never falls back to product/default/selling prices.
export function productionMaterialPreview(inputs:readonly Input[],lots:readonly Lot[],center:string,location:string):number|null{
 const pools=lots.filter(l=>l.center_id===center&&l.location_id===location).map(l=>({...l,remaining:Number(l.available_quantity),value:l.inventory_value===undefined?null:Number(l.inventory_value)}))
  .sort((a,b)=>a.lot_id===null?-1:b.lot_id===null?1:(a.received_at??'').localeCompare(b.received_at??'')||a.lot_id.localeCompare(b.lot_id));
 let total=0;
 for(const input of inputs){let remaining=Number(input.quantity||0);if(!input.product_id||remaining<=0)continue;
  for(const pool of pools.filter(l=>l.product_id===input.product_id&&l.quality_id===input.quality_id&&(!input.lot_id||l.lot_id===input.lot_id))){
   if(remaining<=0)break;if(pool.remaining<=0)continue;if(pool.value===null||!Number.isFinite(pool.value))return null;
   const take=Math.min(remaining,pool.remaining),value=take===pool.remaining?pool.value:Math.round(pool.value*take/pool.remaining*1e6)/1e6;
   total+=value;pool.value-=value;pool.remaining-=take;remaining-=take;
  }
  if(remaining>0.0000001)return null;
 }return total;
}
