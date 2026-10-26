import {readStockSacks} from "@/lib/stock-sacks";
import {requirePermission} from "@/lib/access";
import {StockView,type StockBalance,type StockMovementForFSN} from "./stock-view";

export default async function StockPage({searchParams}:{searchParams:Promise<{product?:string|string[]}>}){
 const params=await searchParams;
 const initialProduct=Array.isArray(params.product)?params.product[0]:params.product;
 const {supabase:s,profile}=await requirePermission("stock");
 const rows:Awaited<ReturnType<typeof query>>["data"] extends (infer R)[]|null ? R[] : never=[];
 function query(){return s.from("stock_movements").select("id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_at,centers(name,code),locations(name,code),products(name,code,category,unit_of_measure,tracks_sacks),product_qualities(name)").order("created_at").order("id")}
 for(let offset=0;;offset+=500){const {data,error}=await query().range(offset,offset+499);if(error)throw new Error("Stock could not be loaded: "+error.message);rows.push(...data);if(data.length<500)break}
 const grouped=new Map<string,StockBalance>();
 for(const r of rows){
  const c=Array.isArray(r.centers)?r.centers[0]:r.centers;const l=Array.isArray(r.locations)?r.locations[0]:r.locations;const p=Array.isArray(r.products)?r.products[0]:r.products;const q=Array.isArray(r.product_qualities)?r.product_qualities[0]:r.product_qualities;
  const key=[r.center_id,r.location_id,r.product_id,r.quality_id].join(":");
  const old=grouped.get(key)??{key,centerId:r.center_id,center:`${c?.code??""} · ${c?.name??""}`,locationId:r.location_id,location:`${l?.code??""} · ${l?.name??""}`,productId:r.product_id,productCode:p?.code??"",product:p?.name??"",category:p?.category?.trim()||"Uncategorized",quality:q?.name??"",unit:p?.unit_of_measure??"unit",qty:0,value:0,tracksSacks:p?.tracks_sacks};
  const sign=["purchase_in","transfer_in","adjustment_in"].includes(r.movement_type)?1:-1;old.qty+=sign*Number(r.quantity);old.value+=sign*Number(r.quantity)*Number(r.unit_cost);grouped.set(key,old);
 }
 const sacks=await readStockSacks(s,profile.organization_id);
 for(const [key,row] of grouped){row.sacks=sacks.get(key);}
 const stock=[...grouped.values()].filter(x=>Math.abs(x.qty)>.0001||(x.sacks??0)>0).sort((a,b)=>a.category.localeCompare(b.category)||a.product.localeCompare(b.product)||a.center.localeCompare(b.center)||a.location.localeCompare(b.location));
 const movements:StockMovementForFSN[]=rows.filter(r=>r.movement_type==="sale_out"||(r.movement_type==="adjustment_in"&&["sales_return","sale_cancellation"].includes(r.reference_type))).map(r=>({centerId:r.center_id,locationId:r.location_id,productId:r.product_id,qualityId:r.quality_id,kind:r.movement_type==="sale_out"?"sale":"return",quantity:Number(r.quantity),date:r.created_at,referenceId:r.reference_id}));
 return <StockView asOf={new Date().toISOString()} initialProduct={initialProduct} initialStock={stock} fsnMovements={movements} isAdmin={["super_admin","admin"].includes(profile.role)} canAdjust={profile.role==="super_admin"||profile.permissions.includes("stock_adjustment")}/>;
}
