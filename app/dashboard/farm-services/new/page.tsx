import {farmOptions} from '../data';
import {FarmBillForm} from '../order-form';
import {redirect} from 'next/navigation';
export default async function Page({searchParams}:{searchParams:Promise<{request?:string}>}){
 const{request}=await searchParams,{supabase:s,profile,centers,customers,seasons,services,banks}=await farmOptions();
 const initialRequest=request&&/^[0-9a-f-]{36}$/i.test(request)?request:undefined;
 if(initialRequest){const{data,error}=await s.from('sales_orders').select('id').eq('organization_id',profile.organization_id).eq('created_by',profile.id).eq('request_id',initialRequest).eq('order_source','farm_services').maybeSingle();if(error)throw new Error('Could not check the previous bill. Refresh to retry safely.');if(data)redirect('/dashboard/farm-services/'+data.id);}
 const{data:company,error:companyError}=await s.from('organizations').select('name,receipt_address,receipt_phone,receipt_email').eq('id',profile.organization_id).single();
 if(companyError)throw new Error('Could not load receipt business details. Refresh to retry.');
 return <FarmBillForm key={profile.organization_id+":"+profile.id} receiptCompany={{name:company!.name,contacts:[company!.receipt_address,company!.receipt_phone,company!.receipt_email].filter((v):v is string=>!!v)}} initialRequest={initialRequest} organizationId={profile.organization_id} userId={profile.id} centers={centers} customers={customers} seasons={seasons} services={services} banks={banks}/>;
}
