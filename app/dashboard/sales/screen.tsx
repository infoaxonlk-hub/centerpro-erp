import {requirePermission} from "@/lib/access";
import {SalesManager} from "./sales-manager";
import type {Bank,Center,Customer,Price,Product,Sale} from "./types";
import "./sales.css";
export async function SalesScreen({start="history"}:{start?:"history"|"new"}){
 const {supabase:s,profile}=await requirePermission("sales");
 // Page through every record: totals must not silently stop at Supabase's row limit.
 async function rows(table:string,select:string,order="id"){
  const result:unknown[]=[];
  for(let offset=0;;offset+=500){const {data,error}=await s.from(table).select(select).order(order).range(offset,offset+499);if(error)throw new Error(table+": "+error.message);result.push(...data);if(data.length<500)break;}
  return result;
 }
 let loaded:unknown[][]|null=null;
 try{
  loaded=await Promise.all([
   rows("centers","id,code,name,is_active,allow_multiple_locations,locations(id,name,is_default,is_active)"),
   rows("customers","id,center_id,name,phone,address"),
   rows("products","id,code,name,unit_of_measure,is_active,product_qualities(id,name,is_active)"),
   rows("sales_prices","center_id,quality_id,price"),
   rows("bank_accounts","id,account_number,branch_name,branch_code,is_active,payment_banks(name,is_active)"),
   rows("sales_orders","id,center_id,customer_id,customer_name,sale_number,total_amount,paid_amount,credit_balance,payment_status,confirmed_at,sales_order_lines(product_name,quality_name,unit,quantity,line_total),sales_payments(method,amount)")
  ]);
 }catch(error){console.error(error);}
 if(!loaded)return <section className="panel"><h1>Sales unavailable</h1><p>Sales data could not be loaded. Confirm migrations 017 and 018 have both been applied, then refresh. No incomplete totals are displayed.</p></section>;
 const [centers,customers,products,prices,accounts,sales]=loaded;
 const banks=(accounts as (Bank&{is_active:boolean})[]).map(a=>({...a,payment_banks:Array.isArray(a.payment_banks)?a.payment_banks[0]:a.payment_banks})).filter(a=>a.is_active&&a.payment_banks?.is_active);
 return <SalesManager start={start} isAdmin={["admin","super_admin"].includes(profile.role)} centers={(centers as (Center&{is_active:boolean})[]).filter(c=>c.is_active)} customers={customers as Customer[]} products={(products as (Product&{is_active:boolean})[]).filter(p=>p.is_active)} prices={prices as Price[]} banks={banks} sales={sales as Sale[]}/>;
}
