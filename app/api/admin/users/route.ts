import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBusinessApi, AccessError } from "@/lib/business-access";
import { permissionEntitled } from "@/lib/business-modules";

async function requireAdmin() {
  try {
    const {user,profile,business}=await requireBusinessApi("users");
    if (!["super_admin","admin"].includes(profile.role) || (profile.role!=="super_admin"&&!profile.permissions?.includes("users"))) throw new Error("FORBIDDEN");
    return {...profile,id:user.id,enabledModules:business.enabledModules};
  }catch(error){
    if(error instanceof AccessError)throw new Error(error.status===401?"UNAUTHENTICATED":"FORBIDDEN");
    throw error;
  }
}
function assertAssignedPermissions(values:string[],modules:readonly string[]){
 if(values.some(permission=>!permissionEntitled(permission,modules)))throw new Error("Cannot assign permissions for a module unavailable to this business.");
}

const permissionsSchema=z.array(z.enum(["dashboard","farm_services","farm_services_manage","sales","purchases","stock","manufacturing","stock_adjustment","labor","cash","payment_reports","centers","users","masters","product_create","product_edit","audit"]));
const createUserSchema = z.object({
  email: z.string().email(), password: z.string().min(8).max(72), fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional(), role: z.enum(["admin", "center_user"]),
  centerIds: z.array(z.string().uuid()).default([]),
  permissions: permissionsSchema.default(["dashboard"]),
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
    const centerIds=[...new Set(input.centerIds)];
    if(centerIds.length){const {data:valid,error:centersError}=await admin.from("centers").select("id").eq("organization_id",current.organization_id).in("id",centerIds);if(centersError||valid?.length!==centerIds.length)return NextResponse.json({error:"Select centers from this organization"},{status:400})}
    assertAssignedPermissions(input.permissions,current.enabledModules);
    const uniquePermissions=normalizePermissions(input.permissions,input.role);
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:input.email,password:input.password,email_confirm:true,user_metadata:{full_name:input.fullName}});
    if(createError||!created.user) throw createError??new Error("User creation failed");
    const userId=created.user.id;
    const {error:profileError}=await admin.from("profiles").insert({id:userId,organization_id:current.organization_id,email:input.email,full_name:input.fullName,phone:input.phone||null,role:input.role,permissions:uniquePermissions});
    if(profileError){await admin.auth.admin.deleteUser(userId);throw profileError;}
    if(centerIds.length){const {error}=await admin.from("user_center_access").insert(centerIds.map(centerId=>({user_id:userId,center_id:centerId})));if(error){await admin.auth.admin.deleteUser(userId);throw error;}}
    await admin.from("audit_logs").insert({organization_id:current.organization_id,action:"user_created",entity_type:"profile",entity_id:userId,after_data:{email:input.email,fullName:input.fullName,role:input.role,centerIds,permissions:uniquePermissions}});
    return NextResponse.json({id:userId},{status:201});
  } catch(error){const message=error instanceof Error?error.message:"Request failed";return NextResponse.json({error:message},{status:message==="UNAUTHENTICATED"?401:message==="FORBIDDEN"?403:400});}
}

function normalizePermissions(values:string[],role:"admin"|"center_user"){const chosen=new Set(["dashboard",...values]);if(role==="center_user")chosen.delete("users");if(chosen.has("product_create")||chosen.has("product_edit"))chosen.add("masters");if(chosen.has("stock_adjustment"))chosen.add("stock");return [...chosen]}
const updateAccessSchema=z.object({id:z.string().uuid(),fullName:z.string().trim().min(2).max(120),phone:z.string().trim().max(30),role:z.enum(["admin","center_user"]),centerIds:z.array(z.string().uuid()),permissions:permissionsSchema});
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
    if("permissions" in body || "centerIds" in body){
      const input=updateAccessSchema.parse(body);
      const {data:target,error:targetError}=await admin.from("profiles").select("id,organization_id,role,full_name,phone,permissions,user_center_access(center_id)").eq("id",input.id).single();
      if(targetError||!target||target.organization_id!==current.organization_id)throw new Error("FORBIDDEN");
      if(target.role==="super_admin")return NextResponse.json({error:"Super Admin access is protected"},{status:400});
      if(input.id===current.id&&(input.role!==target.role||!input.permissions.includes("users")))return NextResponse.json({error:"Keep your own role and User Management access"},{status:400});
      const centerIds=[...new Set(input.centerIds)];
      if(input.role==="center_user"&&!centerIds.length)return NextResponse.json({error:"Assign at least one center"},{status:400});
      if(centerIds.length){const {data:valid,error:centersError}=await admin.from("centers").select("id").eq("organization_id",current.organization_id).in("id",centerIds);if(centersError||valid?.length!==centerIds.length)return NextResponse.json({error:"Select centers from this organization"},{status:400})}
      assertAssignedPermissions(input.permissions,current.enabledModules);
      const permissions=normalizePermissions(input.permissions,input.role);
      const previousCenters=(target.user_center_access??[]).map(access=>access.center_id);
      const {error:profileError}=await admin.from("profiles").update({full_name:input.fullName,phone:input.phone||null,role:input.role,permissions}).eq("id",input.id);if(profileError)throw profileError;
      const {error:deleteError}=await admin.from("user_center_access").delete().eq("user_id",input.id);
      const {error:insertError}=deleteError?{error:deleteError}:centerIds.length?await admin.from("user_center_access").insert(centerIds.map(centerId=>({user_id:input.id,center_id:centerId}))):{error:null};
      if(insertError){await admin.from("user_center_access").delete().eq("user_id",input.id);if(previousCenters.length)await admin.from("user_center_access").insert(previousCenters.map(centerId=>({user_id:input.id,center_id:centerId})));await admin.from("profiles").update({full_name:target.full_name,phone:target.phone,role:target.role,permissions:target.permissions}).eq("id",input.id);throw insertError;}
      await admin.from("audit_logs").insert({organization_id:current.organization_id,actor_id:current.id,action:"user_access_updated",entity_type:"profile",entity_id:input.id,after_data:{role:input.role,centerIds,permissions}});
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
