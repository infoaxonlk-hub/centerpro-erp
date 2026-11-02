import {requirePermission} from '@/lib/access';
import {readAll} from '@/lib/read-all';
import {PartyMasterManager} from './party-master-manager';
import type {PartyRow,PartyOrder} from '@/lib/party-master';
type RawOrder={id:string;supplier_id?:string|null;customer_id?:string|null;order_source?:string;po_number?:string;sale_number?:string;created_at?:string;confirmed_at?:string;total_amount:number|string;status:string;centers:{code:string;name:string}|{code:string;name:string}[]|null};
type Balance={id:string;purchase_order_id?:string;sales_order_id?:string;outstanding_amount:number|string;status:string;customer_id?:string;invoice_number?:string;total_amount?:number|string;created_at?:string;centers?:RawOrder['centers']};
export async function PartyDirectoryScreen({kind,initialId,services=false,masters=false}:{kind:'supplier'|'customer';initialId?:string;services?:boolean;masters?:boolean}){
 const supplier=kind==='supplier',{supabase:s,profile}=await requirePermission(supplier?(masters?'masters':'purchases'):services?'farm_services':'sales');
 const [parties,raw,balances,centers]=await Promise.all([
  readAll<PartyRow>(s,supplier?'suppliers':'customers',supplier?'id,name,phone,address,is_active':'id,name,phone,address,center_id,is_active',profile.organization_id),
  readAll<RawOrder>(s,supplier?'purchase_orders':'sales_orders',supplier?'id,supplier_id,po_number,created_at,total_amount,status,centers(code,name)':'id,customer_id,order_source,sale_number,confirmed_at,total_amount,status,centers(code,name)',profile.organization_id),
  readAll<Balance>(s,supplier?'supplier_payables':'sales_invoices',supplier?'id,purchase_order_id,outstanding_amount,status':'id,sales_order_id,customer_id,invoice_number,total_amount,created_at,outstanding_amount,status,centers(code,name)',profile.organization_id),
  supplier?Promise.resolve([]):readAll<{id:string;code:string;name:string;is_active:boolean}>(s,'centers','id,code,name,is_active',profile.organization_id)
 ]);
 // Retain the directory's existing invoice/payable balance projection.
 const due=new Map<string,number>();for(const b of balances){if(['void','cancelled'].includes(b.status))continue;const id=(supplier?b.purchase_order_id:b.sales_order_id)!;due.set(id,(due.get(id)??0)+Number(b.outstanding_amount));}
 const orders:PartyOrder[]=raw.map(o=>{const c=Array.isArray(o.centers)?o.centers[0]:o.centers;const href=supplier?`/dashboard/purchases/${o.id}`:o.order_source==='farm_services'?`/dashboard/farm-services/${o.id}`:services?null:`/dashboard/sales/${o.id}`;return{id:o.id,partyId:(supplier?o.supplier_id:o.customer_id)??null,number:(supplier?o.po_number:o.sale_number)!,date:(supplier?o.created_at:o.confirmed_at)!,center:`${c?.code??''} · ${c?.name??''}`,total:Number(o.total_amount),due:o.status==='cancelled'?0:due.get(o.id)??0,status:o.status,href}});
 // Services users can see shared invoices without being allowed to open stock
 // sales. Keep those existing open items in the account, without order details.
 if(!supplier){const ids=new Set(raw.map(o=>o.id));for(const invoice of balances){if(!invoice.sales_order_id||ids.has(invoice.sales_order_id)||invoice.status==='cancelled')continue;const c=Array.isArray(invoice.centers)?invoice.centers[0]:invoice.centers;orders.push({id:invoice.sales_order_id,partyId:invoice.customer_id??null,number:invoice.invoice_number!,date:invoice.created_at!,center:[c?.code,c?.name].filter(Boolean).join(' · '),total:Number(invoice.total_amount),due:Number(invoice.outstanding_amount),status:invoice.status,href:null});}}
 return <PartyMasterManager kind={kind} services={services} initialRows={parties} orders={orders} initialId={initialId} centers={centers.filter(c=>c.is_active)} canCreate={['admin','super_admin'].includes(profile.role)} paymentHref={supplier?(masters?undefined:'/dashboard/payment-reports/payables'):services?'/dashboard/farm-services/accounts':'/dashboard/sales/receivables'}/>;
}
