import {requirePermission} from "@/lib/access";
import {readAll} from "@/lib/read-all";
import {PartyDirectory,type Party,type PartyOrder} from "./party-directory";
import type {StandardSupplierOverride} from "@/lib/supplier-field-config";
import "@/app/navigation-restoration.css";
type RawOrder={id:string;supplier_id?:string|null;customer_id?:string|null;po_number?:string;sale_number?:string;created_at?:string;confirmed_at?:string;total_amount:number|string;status:string;centers:{code:string;name:string}|{code:string;name:string}[]|null};
type Balance={id:string;purchase_order_id?:string;sales_order_id?:string;outstanding_amount:number|string;status:string};
export async function PartyDirectoryScreen({kind}:{kind:"supplier"|"customer"}){
 const supplier=kind==="supplier",{supabase:s,profile}=await requirePermission(supplier?"purchases":"sales");
 const [parties,raw,balances,customFieldLabels,standardOverrides]=await Promise.all([
  readAll<Party>(s,supplier?"suppliers":"customers",supplier?"id,name,phone,address,is_active,nic_or_registration,bank_details,notes,custom_values":"id,name,phone,address,center_id",profile.organization_id),
  readAll<RawOrder>(s,supplier?"purchase_orders":"sales_orders",supplier?"id,supplier_id,po_number,created_at,total_amount,status,centers(code,name)":"id,customer_id,sale_number,confirmed_at,total_amount,status,centers(code,name)",profile.organization_id),
  readAll<Balance>(s,supplier?"supplier_payables":"sales_invoices",supplier?"id,purchase_order_id,outstanding_amount,status":"id,sales_order_id,outstanding_amount,status",profile.organization_id),
  supplier ? s.from("supplier_custom_fields").select("field_key,label").eq("organization_id",profile.organization_id).eq("is_active",true).order("sort_order").then(({data,error})=>{if(error)throw new Error(error.message);return data??[]}) : Promise.resolve([]),
  supplier ? s.from("supplier_standard_fields").select("field_key,label,is_active,is_required").eq("organization_id",profile.organization_id).then(({data,error})=>{if(error)throw new Error(error.message);return (data??[]) as StandardSupplierOverride[]}) : Promise.resolve([] as StandardSupplierOverride[])
 ]);
 const due=new Map<string,number>();for(const b of balances){if(["void","cancelled"].includes(b.status))continue;const id=(supplier?b.purchase_order_id:b.sales_order_id)!;due.set(id,(due.get(id)??0)+Number(b.outstanding_amount));}
 const orders:PartyOrder[]=raw.map(o=>{const c=Array.isArray(o.centers)?o.centers[0]:o.centers;return{id:o.id,partyId:(supplier?o.supplier_id:o.customer_id)??null,number:(supplier?o.po_number:o.sale_number)!,date:(supplier?o.created_at:o.confirmed_at)!,center:`${c?.code??""} · ${c?.name??""}`,total:Number(o.total_amount),due:o.status==="cancelled"?0:due.get(o.id)??0,status:o.status}});
 return <PartyDirectory kind={kind} parties={parties} orders={orders} createHref={supplier?(profile.permissions.includes("masters")?"/dashboard/masters?tab=suppliers":"/dashboard/purchases/new"):"/dashboard/sales/customers/manage"} customFieldLabels={customFieldLabels} standardOverrides={standardOverrides}/>;
}
