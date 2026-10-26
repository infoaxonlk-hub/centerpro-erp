import {notFound} from "next/navigation";
import { requirePermission } from "@/lib/access";
import { LaborManager } from "./labor-manager";

export async function LaborScreen({view,sessionId}:{view:"laborers"|"sessions";sessionId?:string}){
 const {supabase,profile}=await requirePermission("labor");
 const {data:linked,error:linkedError}=await supabase.rpc("labor_linked_orders");
 if(linkedError)throw new Error("Labor order totals could not be loaded.");
 type LinkedOrder={id:string;labor_session_id:string;labor_load_count:number;purchase_order_lines?:{quantity:number|string;sack_count?:number}[];sales_order_lines?:{quantity:number|string;unit:string}[]};
 const linkedOrders=linked as {purchases:LinkedOrder[];sales:LinkedOrder[]}|null;
 const sessionQuery=supabase.from("labor_sessions").select("id,center_id,session_date,operation,title,status,notes,centers(code,name),labor_session_workers(laborer_id,rate_basis,rate,laborers(full_name))").order("session_date",{ascending:false});
 const [{data:centers},{data:laborers},{data:sessions},{data:purchases},{data:sales},{data:payments}]=await Promise.all([
  supabase.from("centers").select("id,code,name,is_active").eq("is_active",true).order("name"),
  supabase.from("laborers").select("id,full_name,phone,rate_basis,rate,is_active").order("full_name"),
  sessionId?sessionQuery.eq("id",sessionId):sessionQuery.limit(100),
  Promise.resolve({data:linkedOrders?.purchases??[]}),
  Promise.resolve({data:linkedOrders?.sales??[]}),
  supabase.from("labor_payments").select("session_id,laborer_id,amount"),
 ]);
 if(sessionId&&!sessions?.length)notFound();
 const orders=[...(purchases??[]).map(x=>({...x,kind:"purchase"})),...(sales??[]).map(x=>({...x,kind:"sales"}))];
 return <LaborManager sessionId={sessionId} view={view} organizationId={profile.organization_id} centers={centers??[]} laborers={laborers??[]} sessions={(sessions??[]) as never} orders={orders} payments={payments??[]} canManage={profile.role==="admin"||profile.role==="super_admin"}/>;
}
