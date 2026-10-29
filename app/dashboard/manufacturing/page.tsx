import Link from "next/link";
import { Factory, PackageCheck, PackageOpen, Wheat } from "lucide-react";
import { requirePermission } from "@/lib/access";
import { ManufacturingWorkspace,type Row } from "./workspace";
import {readAll} from "@/lib/read-all";
import "./manufacturing.css";

export default async function ManufacturingPage(){
 const {supabase,profile}=await requirePermission("manufacturing","manufacturing");
 const errorOrders=(await readAll<Row>(supabase,"manufacturing_orders","id,order_number,process_type,method,status,rice_variety,order_date,created_at,total_cost,manufacturing_order_inputs(quantity,input_kind),manufacturing_order_outputs(quantity,output_kind)",profile.organization_id)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const active=errorOrders.filter(x=>x.status==="draft").length;
 const completed=errorOrders.filter(x=>x.status==="completed").length;
 const milling=errorOrders.filter(x=>x.process_type==="milling").length;
 const packing=errorOrders.filter(x=>x.process_type==="packing").length;
 return <div className="manufacturing-page">
  <div className="page-heading manufacturing-heading"><div><span className="eyebrow dark">PRODUCTION WORKSPACE</span><h1>Manufacturing</h1><p>Manage milling, by-products and rice packing while keeping each batch traceable.</p></div><div className="manufacturing-actions"><Link className="ghost" href="/dashboard/manufacturing/recipes">Recipes / BoM</Link><Link className="primary" href="/dashboard/manufacturing/orders/new?process=milling"><Wheat size={16}/> New production order</Link></div></div>
  <div className="manufacturing-metrics">
   <article className="metric"><span className="manufacturing-metric-icon violet"><Factory size={18}/></span><span>Draft orders</span><strong>{active}</strong><small>Saved, awaiting completion</small></article>
   <article className="metric"><span className="manufacturing-metric-icon green"><PackageCheck size={18}/></span><span>Completed orders</span><strong>{completed}</strong><small>All recorded production runs</small></article>
   <article className="metric"><span className="manufacturing-metric-icon gold"><Wheat size={18}/></span><span>Milling orders</span><strong>{milling}</strong><small>Own or external mill</small></article>
   <article className="metric"><span className="manufacturing-metric-icon blue"><PackageOpen size={18}/></span><span>Packing runs</span><strong>{packing}</strong><small>Bulk rice to bagged stock</small></article>
  </div>
  <ManufacturingWorkspace orders={errorOrders}/>
 </div>;
}
