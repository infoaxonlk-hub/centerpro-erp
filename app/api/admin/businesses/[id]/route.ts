import { z } from "zod";
import { requireSuperAdmin, AccessError } from "@/lib/business-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessConfigurationSchema, platformFailure, readPlatformBusiness,assertSavedBusinessModules,platformRpcError } from "@/lib/platform-businesses";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    await requireSuperAdmin();
    const id = z.string().uuid().parse((await context.params).id);
    const business = await readPlatformBusiness(id);
    const { data: history, error } = await createAdminClient().from("business_subscription_history")
      .select("id,before_data,after_data,created_at").eq("organization_id", id)
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error("Could not read subscription history.");
    const { data: lifecycleHistory, error: lifecycleError } = await createAdminClient()
      .from("platform_business_lifecycle_audit")
      .select("id,request_id,business_id,business_name,action,actor_id,actor_name,reason,before_status,after_status,created_at")
      .eq("business_id", id).order("created_at", { ascending: false }).limit(50);
    if (lifecycleError) throw new Error("Could not read business lifecycle history.");
    return Response.json({ business, history, lifecycleHistory }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return platformFailure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { user } = await requireSuperAdmin();
    const id = z.string().uuid().parse((await context.params).id);
    const input = businessConfigurationSchema.parse(await request.json());
    const current = await readPlatformBusiness(id);
    if (current.business_status === "archived") throw new AccessError(409, "Archived businesses must be restored before editing.");
    const { error } = await createAdminClient().rpc("platform_save_business", {
      p_actor: user.id, p_org: id, p_details: input.details,
      p_subscription: input.subscription, p_modules: input.modules,
    });
    if (error) {
      if (error.code === "P0002") throw new AccessError(404, "Business not found.");
      if (error.code === "55000") throw new AccessError(409, "Archived businesses must be restored before editing.");
      throw platformRpcError(error.code,"Business configuration save");
    }
    const business=await readPlatformBusiness(id);
    assertSavedBusinessModules(business,input.modules);
    return Response.json({ ok: true,business },{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return platformFailure(error); }
}
