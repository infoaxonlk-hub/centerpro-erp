"use server";
import {requirePermission} from "@/lib/access";
export async function saveProductImage(form:FormData):Promise<{url?:string;error?:string}>{
 try{
  const {supabase:s,profile}=await requirePermission("masters","masters");
  if(!profile.permissions.includes("product_edit"))return {error:"Product editing permission is required."};
  const id=String(form.get("productId")??""),file=form.get("image");
  if(!(file instanceof File)||!file.size||file.size>2097152)return {error:"Choose a JPG, PNG or WebP image up to 2 MB."};
  const bytes=Buffer.from(await file.arrayBuffer());
  const ext=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"png":bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"jpg":bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP"?"webp":null;
  if(!ext)return {error:"This file is not a supported image."};
  const {data:product,error:loadError}=await s.from("products").select("id,image_path").eq("id",id).eq("organization_id",profile.organization_id).single();
  if(loadError||!product)return {error:"Product could not be loaded. Check migration 038 and your access."};
  const path=`${profile.organization_id}/${id}/${crypto.randomUUID()}.${ext}`;
  const {error:uploadError}=await s.storage.from("product-images").upload(path,bytes,{contentType:ext==="jpg"?"image/jpeg":`image/${ext}`,upsert:false});
  if(uploadError)return {error:uploadError.message};
  const {data:updated,error:updateError}=await s.from("products").update({image_path:path}).eq("id",id).eq("organization_id",profile.organization_id).select("id");
  if(updateError||!updated?.length){await s.storage.from("product-images").remove([path]);return {error:updateError?.message??"Image update was not permitted."};}
  if(product.image_path?.startsWith(`${profile.organization_id}/${id}/`))await s.storage.from("product-images").remove([product.image_path]);
  const {data:signed,error:signError}=await s.storage.from("product-images").createSignedUrl(path,3600);
  return signError?{error:"Image saved. Refresh the page to view it."}:{url:signed?.signedUrl};
 }catch{return {error:"Image could not be saved. Check your connection and permissions."};}
}
