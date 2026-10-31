import {redirect} from 'next/navigation';
import {requireSuperAdmin,readBusinessAccess,AccessError} from '@/lib/business-access';
export default async function OwnWorkspace(){
 let context;
 try{context=await requireSuperAdmin();}catch(error){if(error instanceof AccessError&&error.status===401)redirect('/login');if(error instanceof AccessError&&error.status===403)redirect('/dashboard?error=Access denied');throw error;}
 // Read the signed-in profile's business on every entry. Never accept an org ID
 // or reuse the platform list's cached subscription summary for authorization.
 const business=await readBusinessAccess(context.supabase);
 redirect(business.operational?'/dashboard':'/dashboard/account');
}
