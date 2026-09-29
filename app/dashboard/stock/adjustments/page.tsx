import Link from "next/link";
import {requirePermission} from "@/lib/access";
import {AdjustmentForm} from "./adjustment-form";
import "../stock-chart.css";

export default async function AdjustmentsPage(){
 const {supabase:s}=await requirePermission("stock_adjustment");
 const [{data:centers,error:ce},{data:products,error:pe}]=await Promise.all([
  s.from("centers").select("id,code,name,locations(id,code,name,is_active)").eq("is_active",true).order("name"),
  s.from("products").select("id,code,name,unit_of_measure,product_qualities(id,name,is_active)").eq("is_active",true).order("name")
 ]);
 if(ce||pe)throw new Error(ce?.message??pe?.message);
 const rows:Awaited<ReturnType<typeof load>>["data"] extends (infer R)[]|null?R[]:never=[];
 function load(){return s.from("stock_movements").select("id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost").order("created_at").order("id")}
 for(let offset=0;;offset+=500){const {data,error}=await load().range(offset,offset+499);if(error)throw new Error(error.message);rows.push(...data);if(data.length<500)break}
 const balances=new Map<string,{quantity:number;value:number}>();
 for(const r of rows){const key=[r.center_id,r.location_id,r.product_id,r.quality_id].join(":");const old=balances.get(key)??{quantity:0,value:0};const sign=["purchase_in","transfer_in","adjustment_in"].includes(r.movement_type)?1:-1;old.quantity+=sign*Number(r.quantity);old.value+=sign*Number(r.quantity)*Number(r.unit_cost);balances.set(key,old)}
 return <><div className="page-heading"><div><span className="eyebrow dark">INVENTORY CONTROL</span><h1>Stock adjustment</h1><p>Count a product at a location and record the difference with a reason.</p></div><Link className="ghost" href="/dashboard/stock">Stock explorer</Link></div>
 <AdjustmentForm centers={(centers??[]).map(c=>({id:c.id,label:`${c.code} · ${c.name}`,locations:(c.locations??[]).filter(l=>l.is_active).map(l=>({id:l.id,label:`${l.code} · ${l.name}`}))})).filter(c=>c.locations.length)} products={(products??[]).map(p=>({id:p.id,label:`${p.code} · ${p.name}`,unit:p.unit_of_measure,qualities:(p.product_qualities??[]).filter(q=>q.is_active).map(q=>({id:q.id,label:q.name}))})).filter(p=>p.qualities.length)} balances={[...balances].map(([key,value])=>({key,...value}))}/></>;
}
