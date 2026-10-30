import {farmOptions} from './data';
import {readAll} from '@/lib/read-all';
import {FarmOrders,type FarmOrder} from './orders';
export default async function Page(){const{profile,supabase,seasons,services,customers}=await farmOptions();const orders=await readAll<FarmOrder>(supabase,'sales_orders','id,sale_number,customer_id,customer_name,order_source,status,payment_status,confirmed_at,total_amount,paid_amount,credit_balance,season_id,season_name,service_location,sales_order_lines(product_id,product_name,quantity,unit,unit_price)',profile.organization_id);return <FarmOrders orders={orders.filter(o=>o.order_source==='farm_services')} seasons={seasons} services={services} customers={customers}/>;}
