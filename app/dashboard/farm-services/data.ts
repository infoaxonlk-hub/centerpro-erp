import {requirePermission} from '@/lib/access';
import {readAll} from '@/lib/read-all';
import type {FarmSeason,FarmService} from '@/lib/farm-services';
import type {Center,Customer,Bank} from '../sales/types';
export async function farmOptions(){
 const context=await requirePermission('farm_services'),{supabase:s,profile}=context;
 const [centers,customers,seasons,products,banks]=await Promise.all([
 readAll<Center&{is_active:boolean}>(s,'centers','id,code,name,is_active,locations(id,name,is_default,is_active)',profile.organization_id),
 readAll<Customer&{is_active:boolean}>(s,'customers','id,center_id,name,phone,address,is_active',profile.organization_id),
 readAll<FarmSeason>(s,'farm_seasons','id,name,is_active,is_default',profile.organization_id),
 readAll<FarmService&{product_type:string}>(s,'products','id,code,name,product_type,unit_of_measure,default_sales_price,is_active',profile.organization_id),
 readAll<Bank&{is_active:boolean}>(s,'bank_accounts','id,account_number,branch_name,branch_code,is_active,payment_banks(name,is_active)',profile.organization_id)]);
 return{...context,centers:centers.filter(c=>c.is_active),customers,seasons,services:products.filter(p=>p.product_type==='service'),banks:banks.filter(b=>b.is_active&&b.payment_banks?.is_active)};
}
