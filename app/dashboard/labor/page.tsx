import { requirePermission } from "@/lib/access";
import { LaborManager } from "./labor-manager";

export default async function LaborPage(){
 const {supabase,profile}=await requirePermission("labor");
 const [{data:centers},{data:laborers},{data:sessions},{data:purchases},{data:sales},{data:payments}]=await Promise.all([
  supabase.from("centers").select("id,code,name,is_active").eq("is_active",true).order("name"),
  supabase.from("laborers").select("id,full_name,phone,rate_basis,rate,is_active").order("full_name"),
  supabase.from("labor_sessions").select("id,center_id,session_date,operation,title,status,notes,centers(code,name),labor_session_workers(laborer_id,rate_basis,rate,laborers(full_name))").order("session_date",{ascending:false}).limit(100),
  supabase.from("purchase_orders").select("id,labor_session_id,labor_load_count,purchase_order_lines(quantity,sack_count)").not("labor_session_id","is",null),
  supabase.from("sales_orders").select("id,labor_session_id,labor_load_count,sales_order_lines(quantity,unit)").not("labor_session_id","is",null),
  supabase.from("labor_payments").select("session_id,laborer_id,amount"),
 ]);
 const orders=[...(purchases??[]).map((x:any)=>({...x,kind:"purchase"})),...(sales??[]).map((x:any)=>({...x,kind:"sales"}))];
 return <LaborManager organizationId={profile.organization_id} centers={centers??[]} laborers={laborers??[]} sessions={(sessions??[]) as never} orders={orders} payments={payments??[]} canManage={profile.role==="admin"||profile.role==="super_admin"}/>;
}
