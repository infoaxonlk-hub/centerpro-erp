import { z } from "zod";
import { requireSuperAdmin, AccessError } from "@/lib/business-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessConfigurationSchema, platformFailure, readPlatformBusiness } from "@/lib/platform-businesses";
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
    return Response.json({ business, history });
  } catch (error) { return platformFailure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { user } = await requireSuperAdmin();
    const id = z.string().uuid().parse((await context.params).id);
    const input = businessConfigurationSchema.parse(await request.json());
    await readPlatformBusiness(id);
    const { error } = await createAdminClient().rpc("platform_save_business", {
      p_actor: user.id, p_org: id, p_details: input.details,
      p_subscription: input.subscription, p_modules: input.modules,
    });
    if (error) {
      if (error.code === "P0002") throw new AccessError(404, "Business not found.");
      throw new Error("Business configuration transaction failed.");
    }
    return Response.json({ ok: true });
  } catch (error) { return platformFailure(error); }
}
