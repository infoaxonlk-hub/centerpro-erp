import {LegalMasterLink} from '@/components/legal-master-link';
import {requirePermission} from '@/lib/access';
import {readAll} from '@/lib/read-all';
import {CreditLedger,type CreditRow} from '@/components/credit-ledger';
import {creditBanks} from '@/lib/credit-data';
type Invoice={id:string;customer_id:string;sales_order_id:string;invoice_number:string;total_amount:number;outstanding_amount:number;status:string;created_at:string;customers:{name:string;phone:string}|null;centers:{name:string;code:string}|null};
export default async function Page(){
 const{supabase:s,profile}=await requirePermission('farm_services');
 const[invoices,receivables,orders,banks]=await Promise.all([
 readAll<Invoice>(s,'sales_invoices','id,customer_id,sales_order_id,invoice_number,total_amount,outstanding_amount,status,created_at,customers(name,phone),centers(name,code)',profile.organization_id),
 readAll<{sales_order_id:string;original_amount:number;is_void:boolean}>(s,'customer_receivables','id,sales_order_id,original_amount,is_void',profile.organization_id),
 readAll<{id:string;order_source:string}>(s,'sales_orders','id,order_source',profile.organization_id),creditBanks(s)]);
 const originals=new Map(receivables.filter(r=>!r.is_void).map(r=>[r.sales_order_id,Number(r.original_amount)])),farmIds=new Set(orders.filter(o=>o.order_source==='farm_services').map(o=>o.id));
 const rows:CreditRow[]=invoices.filter(i=>i.status!=='cancelled'&&originals.has(i.sales_order_id)).map(i=>({id:i.id,customerId:i.customer_id,billId:i.sales_order_id,number:i.invoice_number,date:i.created_at,center:[i.centers?.code,i.centers?.name].filter(Boolean).join(' / '),party:i.customers?.name??'Customer',phone:i.customers?.phone??'',total:Number(i.total_amount),original:originals.get(i.sales_order_id)!,outstanding:Number(i.outstanding_amount),status:i.status,orderSource:farmIds.has(i.sales_order_id)?'farm_services':'stock'}));
 return <><LegalMasterLink href="/dashboard/farm-services/customers"/><p className="farm-account-note">Shared customer receivables: normal credit sales and Services bills are included once. Balances below cover all matching bills, not just one service.</p><CreditLedger key={profile.organization_id+":"+profile.id} type="receivable" rows={rows} banks={banks} farmScope={profile.organization_id+':'+profile.id}/></>;
}
