import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { data: profile } = await supabase.from("profiles").select("organization_id,role,is_active").eq("id", user.id).single();
  if (!profile?.is_active || !["super_admin", "admin"].includes(profile.role)) throw new Error("FORBIDDEN");
  return profile;
}

const createUserSchema = z.object({
  email: z.string().email(), fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional(), role: z.enum(["super_admin", "admin", "center_user"]),
  centerIds: z.array(z.string().uuid()).default([]),
});

export async function GET() {
  try {
    const profile = await requireAdmin(); const admin = createAdminClient();
    const { data, error } = await admin.from("profiles").select("id,full_name,phone,role,is_active,created_at,user_center_access(center_id,centers(name,code))").eq("organization_id", profile.organization_id).order("created_at");
    if (error) throw error; return NextResponse.json(data);
  } catch (error) { const message=error instanceof Error?error.message:"Request failed"; return NextResponse.json({error:message},{status:message==="UNAUTHENTICATED"?401:403}); }
}

export async function POST(request: Request) {
  try {
    const current=await requireAdmin(); const input=createUserSchema.parse(await request.json());
    if(input.role==="center_user"&&!input.centerIds.length) return NextResponse.json({error:"Assign at least one center"},{status:400});
    const admin=createAdminClient();
    const {data:invitation,error:inviteError}=await admin.auth.admin.inviteUserByEmail(input.email,{data:{full_name:input.fullName}});
    if(inviteError||!invitation.user) throw inviteError??new Error("Invitation failed");
    const userId=invitation.user.id;
    const {error:profileError}=await admin.from("profiles").insert({id:userId,organization_id:current.organization_id,full_name:input.fullName,phone:input.phone||null,role:input.role});
    if(profileError){await admin.auth.admin.deleteUser(userId);throw profileError;}
    if(input.centerIds.length){const {error}=await admin.from("user_center_access").insert(input.centerIds.map(centerId=>({user_id:userId,center_id:centerId})));if(error)throw error;}
    await admin.from("audit_logs").insert({organization_id:current.organization_id,action:"user_invited",entity_type:"profile",entity_id:userId,after_data:input});
    return NextResponse.json({id:userId},{status:201});
  } catch(error){const message=error instanceof Error?error.message:"Request failed";return NextResponse.json({error:message},{status:message==="UNAUTHENTICATED"?401:message==="FORBIDDEN"?403:400});}
}

const updateUserSchema=z.object({id:z.string().uuid(),isActive:z.boolean()});
export async function PATCH(request:Request){
  try{
    const current=await requireAdmin();const input=updateUserSchema.parse(await request.json());const admin=createAdminClient();
    const {data:target}=await admin.from("profiles").select("organization_id,role").eq("id",input.id).single();
    if(!target||target.organization_id!==current.organization_id)throw new Error("FORBIDDEN");
    if(target.role==="super_admin"&&current.role!=="super_admin")throw new Error("FORBIDDEN");
    const {error:profileError}=await admin.from("profiles").update({is_active:input.isActive}).eq("id",input.id);if(profileError)throw profileError;
    const {error}=await admin.auth.admin.updateUserById(input.id,{ban_duration:input.isActive?"none":"876000h"});if(error)throw error;
    await admin.from("audit_logs").insert({organization_id:current.organization_id,action:input.isActive?"user_activated":"user_deactivated",entity_type:"profile",entity_id:input.id});
    return NextResponse.json({ok:true});
  }catch(error){const message=error instanceof Error?error.message:"Request failed";return NextResponse.json({error:message},{status:message==="UNAUTHENTICATED"?401:message==="FORBIDDEN"?403:400});}
}
