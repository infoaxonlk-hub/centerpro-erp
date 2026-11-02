import { z } from "zod";
import { requireBusinessApi, AccessError } from "@/lib/business-access";
import { createAdminClient } from "@/lib/supabase/admin";
import {effectiveSupplierBaseFields,type StandardSupplierOverride} from "@/lib/supplier-field-config";

const value = z.string().trim().max(5000);
const rowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nic_or_registration: value.nullable(),
  phone: z.string().trim().max(60).nullable(),
  address: value.nullable(),
  bank_details: value.nullable(),
  notes: value.nullable(),
  custom_values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  import_token: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const inputSchema = z.object({rows:z.array(rowSchema).min(1).max(100)}).strict();

function validDate(text: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed=new Date(text+"T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===text;
}

export async function POST(request: Request) {
  try {
    const {profile, business}=await requireBusinessApi("masters");
    if (!["admin","super_admin"].includes(profile.role) ||
      (profile.role!=="super_admin" && !profile.permissions?.includes("masters"))) {
      return Response.json({error:"Business admin access is required to import suppliers."},{status:403});
    }
    const body=inputSchema.parse(await request.json());
    const admin=createAdminClient();
    const {data:fields,error:fieldsError}=await admin.from("supplier_custom_fields")
      .select("field_key,field_type,is_required")
      .eq("organization_id",profile.organization_id).eq("is_active",true);
    if(fieldsError) throw fieldsError;
    const {data:standardSettings,error:standardError}=await admin.from("supplier_standard_fields")
      .select("field_key,label,is_required,is_active").eq("organization_id",profile.organization_id);
    if(standardError) throw standardError;
    const standard=effectiveSupplierBaseFields((standardSettings??[]) as StandardSupplierOverride[]);
    const allowed=new Map((fields??[]).map(f=>[f.field_key,f]));
    const tokens=new Set<string>();
    const rows=body.rows.map((row,index)=>{
      if(tokens.has(row.import_token))throw new AccessError(400,`Duplicate import row token in batch at row ${index+1}.`);
      tokens.add(row.import_token);
      for(const standardField of standard){
        const fieldValue=row[standardField.key];
        if(!standardField.active && fieldValue)throw new AccessError(400,"Field "+standardField.label+" is no longer active. Export a fresh template.");
        if(standardField.active && standardField.required && !fieldValue)throw new AccessError(400,"Required field "+standardField.label+" is missing at row "+(index+1)+".");
      }
      for(const [key, val] of Object.entries(row.custom_values)) {
        const field=allowed.get(key);
        if(!field)throw new AccessError(400,`Column ${key} is no longer configured. Export a fresh template.`);
        if(typeof val==="string" && val.length>500)throw new AccessError(400,`Custom value ${key} exceeds 500 characters.`);
        if(field.field_type==="number" && val!=="" && (typeof val!=="number" || !Number.isFinite(val)))
          throw new AccessError(400,`Custom value ${key} must be numeric.`);
        if(field.field_type==="date" && val!=="" && (typeof val!=="string" || !validDate(val)))
          throw new AccessError(400,`Custom value ${key} must be a YYYY-MM-DD date.`);
        if(field.field_type==="text" && typeof val!=="string")
          throw new AccessError(400,`Custom value ${key} must be text.`);
      }
      for(const field of allowed.values()){
        if(field.is_required && (row.custom_values[field.field_key]===undefined ||
          row.custom_values[field.field_key]==="")) {
          throw new AccessError(400,`Required supplier field missing: ${field.field_key} (row ${index+1}).`);
        }
      }
      return {...row,organization_id:profile.organization_id};
    });
    if(!business.operational)throw new AccessError(403,"Business workspace is inactive.");
    const {data,error}=await admin.from("suppliers")
      .upsert(rows,{onConflict:"organization_id,import_token",ignoreDuplicates:true})
      .select("id");
    if(error){
      console.error("Supplier bulk insert failed",{code:error.code});
      return Response.json({error:"Supplier batch could not be saved. No rows in this batch were imported.",code:error.code},{status:409});
    }
    const imported=data?.length??0;
    return Response.json({imported,skipped:rows.length-imported},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(error instanceof AccessError)return Response.json({error:error.message},{status:error.status});
    if(error instanceof z.ZodError)return Response.json({error:"Invalid supplier data: "+error.issues.slice(0,3).map(x=>x.path.join(".")+" "+x.message).join("; ")},{status:400});
    console.error("Supplier import request failed",error instanceof Error?error.message:"Unknown");
    return Response.json({error:"Unable to import suppliers. Verify your session and try again."},{status:500});
  }
}
