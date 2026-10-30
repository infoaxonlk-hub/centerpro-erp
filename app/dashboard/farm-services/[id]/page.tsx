import {notFound} from 'next/navigation';
import {requirePermission} from '@/lib/access';
import {FarmReceipt,type FarmReceiptData} from '../receipt';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{print?:string;language?:string}>}){
 const{id}=await params,{print,language}=await searchParams,{supabase:s,profile}=await requirePermission('farm_services');
 const[{data:order,error},{data:org,error:orgError},{data:requests,error:requestError}]=await Promise.all([
 s.from('sales_orders').select('*,sales_order_lines(product_name,quantity,unit,unit_price),sales_payments(method,amount,reference,bank_name,account_number)').eq('id',id).eq('order_source','farm_services').maybeSingle(),
 s.from('organizations').select('name,receipt_address,receipt_phone,receipt_email,receipt_logo_url').eq('id',profile.organization_id).single(),
 s.from('bill_cancel_requests').select('id,reason,status').eq('bill_type','sale').eq('bill_id',id).order('requested_at',{ascending:false})]);
 if(error||orgError)throw new Error(error?.message??orgError?.message);if(!order)notFound();const line=order.sales_order_lines[0];if(!line)throw new Error('Saved service line is missing.');
 const bill:FarmReceiptData={id:order.id,logo:org!.receipt_logo_url,organization:org!.name,contacts:[org!.receipt_address,org!.receipt_phone,org!.receipt_email].filter((v):v is string=>!!v),number:order.sale_number,date:new Date(order.confirmed_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'}),customer:order.customer_name,season:order.season_name,location:order.service_location,description:order.service_description,service:line.product_name,unit:line.unit,quantity:Number(line.quantity),rate:Number(line.unit_price),subtotal:Number(order.service_subtotal),adjustments:order.service_adjustments,total:Number(order.total_amount),paid:Number(order.paid_amount),due:order.status==='cancelled'?0:Number(order.credit_balance),cancelled:order.status==='cancelled',payments:order.sales_payments};
 return <FarmReceipt bill={bill} initialLanguage={language==="ta"?"ta":language==="si"?"si":"en"} requests={requestError?[]:requests??[]} cancellationUnavailable={!!requestError} canReview={['admin','super_admin'].includes(profile.role)} autoPrint={print==='1'}/>;
}
