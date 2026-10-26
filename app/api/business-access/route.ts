import { requireAuthenticatedProfile, readBusinessAccess, AccessError } from "@/lib/business-access";
export async function GET() {
 try {
   const {supabase}=await requireAuthenticatedProfile();
   return Response.json(await readBusinessAccess(supabase),{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){
   return Response.json({error:"Business access could not be verified."},{status:error instanceof AccessError?error.status:503,headers:{"Cache-Control":"private, no-store"}});
 }
}
