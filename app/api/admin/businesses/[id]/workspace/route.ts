import { requireSuperAdmin } from "@/lib/business-access";
import { z } from "zod";
import { inspectBusiness, inspectionSectionSchema } from "@/lib/business-inspection";
import { platformFailure } from "@/lib/platform-businesses";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireSuperAdmin();
    const url=new URL(request.url);
    const section=inspectionSectionSchema.parse(url.searchParams.get("section")??"overview");
    const offset=z.coerce.number().int().min(0).max(1000000).parse(url.searchParams.get("offset")??0);
    const result=await inspectBusiness(z.string().uuid().parse((await params).id),section,offset);
    return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return platformFailure(error);}
}
