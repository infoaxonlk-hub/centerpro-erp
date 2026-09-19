import {requirePermission} from "@/lib/access";
import {StockView,type StockBalance} from "./stock-view";

export default async function StockPage(){
 const {supabase:s,profile}=await requirePermission("stock");
 const {data:rows}=await s.from("stock_movements").select("id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,created_at,centers(name,code),locations(name,code),products(name,code,category,unit_of_measure),product_qualities(name)").order("created_at");
 const grouped=new Map<string,StockBalance>();
 for(const r of rows??[]){
  const c=Array.isArray(r.centers)?r.centers[0]:r.centers;const l=Array.isArray(r.locations)?r.locations[0]:r.locations;const p=Array.isArray(r.products)?r.products[0]:r.products;const q=Array.isArray(r.product_qualities)?r.product_qualities[0]:r.product_qualities;
  const key=[r.center_id,r.location_id,r.product_id,r.quality_id].join(":");
  const old=grouped.get(key)??{key,centerId:r.center_id,center:`${c?.code??""} · ${c?.name??""}`,locationId:r.location_id,location:`${l?.code??""} · ${l?.name??""}`,productId:r.product_id,productCode:p?.code??"",product:p?.name??"",category:p?.category?.trim()||"Uncategorized",quality:q?.name??"",unit:p?.unit_of_measure??"unit",qty:0,value:0};
  const sign=["purchase_in","transfer_in","adjustment_in"].includes(r.movement_type)?1:-1;old.qty+=sign*Number(r.quantity);old.value+=sign*Number(r.quantity)*Number(r.unit_cost);grouped.set(key,old);
 }
 const stock=[...grouped.values()].filter(x=>Math.abs(x.qty)>.0001).sort((a,b)=>a.category.localeCompare(b.category)||a.product.localeCompare(b.product)||a.center.localeCompare(b.center)||a.location.localeCompare(b.location));
 return <StockView initialStock={stock} isAdmin={["super_admin","admin"].includes(profile.role)}/>;
}
