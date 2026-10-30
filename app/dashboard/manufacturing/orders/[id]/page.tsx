import {BomManufacturingOrderForm,type BomOrderDraft} from "../../bom-order-form";
import {BomOrderReview} from "../../bom-order-review";
import {ProductionCostBreakdown} from "../../production-cost-breakdown";
import Link from "next/link";
import {notFound} from "next/navigation";
import {requirePermission} from "@/lib/access";
import {ManufacturingOrderForm,type ManufacturingDraft} from "../../manufacturing-order-form";
import {loadManufacturingOptions,loadManufacturingBoms} from "../../data";
import "../../manufacturing.css";
type Order=Omit<ManufacturingDraft,"manufacturing_order_outputs">&{valuation_method:string|null;status:string;material_cost:number|string;operation_cost:number|string;total_cost:number|string;manufacturing_order_outputs:(ManufacturingDraft["manufacturing_order_outputs"][number]&{lot_number:string;unit_of_measure:string;cost_share_percent:number|string;line_cost:number|string;unit_cost:number|string})[]};
export default async function ManufacturingOrderPage({params}:{params:Promise<{id:string}>}){
 const{id}=await params;if(!/^[a-f0-9-]{36}$/i.test(id))notFound();
 const{supabase,profile}=await requirePermission("manufacturing","manufacturing");
 const{data,error}=await supabase.from("manufacturing_orders").select("*,manufacturing_order_inputs(*),manufacturing_order_outputs(*),manufacturing_order_operations(*)").eq("id",id).eq("organization_id",profile.organization_id).maybeSingle();
 if(error)throw new Error("Production order could not be loaded: "+error.message);if(!data)notFound();
 const order=data as Order;
 const bomOrder=data.bom_snapshot?data as unknown as BomOrderDraft:null;
 const {data:costEntries,error:costError}=await supabase.from("manufacturing_cost_entries").select("*").eq("order_id",id).order("created_at").order("id");if(costError)throw new Error(costError.message);
 if(order.status==="draft"&&bomOrder)return <BomManufacturingOrderForm initialProcess={order.process_type} initialOrder={bomOrder} boms={await loadManufacturingBoms(supabase,profile.organization_id)} {...await loadManufacturingOptions(supabase,profile.organization_id)}/>;
 if(order.status==="draft")return <ManufacturingOrderForm initialProcess={order.process_type} initialOrder={order} {...await loadManufacturingOptions(supabase,profile.organization_id)}/>;
 return <div className="manufacturing-page"><div className="page-heading"><div><span className="eyebrow dark">{order.process_type==='packing'?'PACKING ORDER':'MANUFACTURING ORDER'} · {order.status}</span><h1>{order.order_number}</h1><p>{order.process_type} · {order.order_date}</p></div><Link className="ghost" href="/dashboard/manufacturing">Production orders</Link></div><section className="panel"><h2>Production cost</h2><p>Materials: LKR {Number(order.material_cost).toFixed(2)}</p><p>Operation: LKR {Number(order.operation_cost).toFixed(2)}</p><strong>Total: LKR {Number(order.total_cost).toFixed(2)}</strong></section>{bomOrder&&<BomOrderReview order={bomOrder}/>}<ProductionCostBreakdown entries={costEntries??[]} outputs={order.manufacturing_order_outputs} method={order.valuation_method}/><section className="panel"><h2>Produced lots · original output quantities</h2><p>Current available quantities are shown in Stock explorer.</p>{order.manufacturing_order_outputs.map(row=><article key={row.id}><h3>{row.lot_number||"No posted lot"}</h3><p>{row.quantity} {row.unit_of_measure} · {row.sack_count} sacks</p><Link href={"/dashboard/stock?product="+row.product_id}>View current stock</Link></article>)}</section></div>;
}
