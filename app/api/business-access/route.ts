import { requireAuthenticatedProfile, readBusinessAccess, AccessError } from "@/lib/business-access";
export async function GET() {
 try {
   const {supabase}=await requireAuthenticatedProfile();
   return Response.json(await readBusinessAccess(supabase),{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){
   const status=error instanceof AccessError?error.status:503;
   return Response.json({error:"Business access could not be verified.",code:status===401?"SESSION_REQUIRED":status===403?"ACCOUNT_UNAVAILABLE":"ACCESS_CHECK_UNAVAILABLE"},{status,headers:{"Cache-Control":"private, no-store"}});
 }
}
