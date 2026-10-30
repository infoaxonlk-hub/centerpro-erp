import {farmOptions} from '../data';
import {FarmBillForm} from '../order-form';
import {redirect} from 'next/navigation';
export default async function Page({searchParams}:{searchParams:Promise<{request?:string}>}){
 const{request}=await searchParams,{supabase:s,profile,centers,customers,seasons,services,banks}=await farmOptions();
 const initialRequest=request&&/^[0-9a-f-]{36}$/i.test(request)?request:undefined;
 if(initialRequest){const{data,error}=await s.from('sales_orders').select('id').eq('organization_id',profile.organization_id).eq('created_by',profile.id).eq('request_id',initialRequest).eq('order_source','farm_services').maybeSingle();if(error)throw new Error('Could not check the previous bill. Refresh to retry safely.');if(data)redirect('/dashboard/farm-services/'+data.id);}
 return <FarmBillForm key={profile.organization_id+":"+profile.id} initialRequest={initialRequest} organizationId={profile.organization_id} userId={profile.id} centers={centers} customers={customers} seasons={seasons} services={services} banks={banks}/>;
}
