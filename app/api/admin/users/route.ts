import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { data: profile } = await supabase.from("profiles").select("organization_id,role,is_active,permissions").eq("id", user.id).single();
  if (!profile?.is_active || !["super_admin", "admin"].includes(profile.role) || (profile.role!=="super_admin"&&!profile.permissions?.includes("users"))) throw new Error("FORBIDDEN");
  return profile;
}

const createUserSchema = z.object({
  email: z.string().email(), password: z.string().min(8).max(72), fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional(), role: z.enum(["admin", "center_user"]),
  centerIds: z.array(z.string().uuid()).default([]),
  permissions: z.array(z.enum(["dashboard","sales","purchases","stock","cash","payment_reports","centers","users","masters","audit"])).default(["dashboard"]),
});

export async function GET() {
  try {
    const profile = await requireAdmin(); const admin = createAdminClient();
    const { data, error } = await admin.from("profiles").select("id,email,full_name,phone,role,is_active,permissions,created_at,user_center_access(center_id,centers(name,code))").eq("organization_id", profile.organization_id).order("created_at");
    if (error) throw error; return NextResponse.json(data);
  } catch (error) { const message=error instanceof Error?error.message:"Request failed"; return NextResponse.json({error:message},{status:message==="UNAUTHENTICATED"?401:403}); }
}

export async function POST(request: Request) {
  try {
    const current=await requireAdmin(); const input=createUserSchema.parse(await request.json());
    if(input.role==="center_user"&&!input.centerIds.length) return NextResponse.json({error:"Assign at least one center"},{status:400});
    const admin=createAdminClient();
    const uniquePermissions=[...new Set(["dashboard",...input.permissions])];
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:input.email,password:input.password,email_confirm:true,user_metadata:{full_name:input.fullName}});
    if(createError||!created.user) throw createError??new Error("User creation failed");
    const userId=created.user.id;
    const {error:profileError}=await admin.from("profiles").insert({id:userId,organization_id:current.organization_id,email:input.email,full_name:input.fullName,phone:input.phone||null,role:input.role,permissions:uniquePermissions});
    if(profileError){await admin.auth.admin.deleteUser(userId);throw profileError;}
    if(input.centerIds.length){const {error}=await admin.from("user_center_access").insert(input.centerIds.map(centerId=>({user_id:userId,center_id:centerId})));if(error)throw error;}
    await admin.from("audit_logs").insert({organization_id:current.organization_id,action:"user_created",entity_type:"profile",entity_id:userId,after_data:{email:input.email,fullName:input.fullName,role:input.role,centerIds:input.centerIds,permissions:uniquePermissions}});
    return NextResponse.json({id:userId},{status:201});
  } catch(error){const message=error instanceof Error?error.message:"Request failed";return NextResponse.json({error:message},{status:message==="UNAUTHENTICATED"?401:message==="FORBIDDEN"?403:400});}
}

const updateUserSchema=z.object({id:z.string().uuid(),isActive:z.boolean()});
const resetPasswordSchema=z.object({id:z.string().uuid(),password:z.string().min(8).max(72)});
export async function PATCH(request:Request){
  try{
    const current=await requireAdmin();const body=await request.json();const admin=createAdminClient();
    if("password" in body){
      const input=resetPasswordSchema.parse(body);
      const {data:target}=await admin.from("profiles").select("organization_id,role,email").eq("id",input.id).single();
      if(!target||target.organization_id!==current.organization_id)throw new Error("FORBIDDEN");
      if(target.role==="super_admin")return NextResponse.json({error:"Use secure email recovery for the Super Admin account"},{status:400});
      const {error}=await admin.auth.admin.updateUserById(input.id,{password:input.password});if(error)throw error;
      await admin.from("audit_logs").insert({organization_id:current.organization_id,action:"user_password_reset",entity_type:"profile",entity_id:input.id,after_data:{email:target.email}});
      return NextResponse.json({ok:true});
    }
    const input=updateUserSchema.parse(body);
    const {data:target}=await admin.from("profiles").select("organization_id,role").eq("id",input.id).single();
    if(!target||target.organization_id!==current.organization_id)throw new Error("FORBIDDEN");
    if(target.role==="super_admin")return NextResponse.json({error:"The Super Admin account cannot be deactivated"},{status:400});
    const {error:profileError}=await admin.from("profiles").update({is_active:input.isActive}).eq("id",input.id);if(profileError)throw profileError;
    const {error}=await admin.auth.admin.updateUserById(input.id,{ban_duration:input.isActive?"none":"876000h"});if(error)throw error;
    await admin.from("audit_logs").insert({organization_id:current.organization_id,action:input.isActive?"user_activated":"user_deactivated",entity_type:"profile",entity_id:input.id});
    return NextResponse.json({ok:true});
  }catch(error){const message=error instanceof Error?error.message:"Request failed";return NextResponse.json({error:message},{status:message==="UNAUTHENTICATED"?401:message==="FORBIDDEN"?403:400});}
}
