import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessError, requireSuperAdmin } from "@/lib/business-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformFailure, platformRpcError, readPlatformBusiness } from "@/lib/platform-businesses";

type Context = { params: Promise<{ id: string }> };
const inputSchema = z.object({
  confirmationName: z.string().trim().min(2).max(120),
  reason: z.string().trim().min(10).max(500),
});
function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === "cross-site") {
    throw new AccessError(403, "Request origin is not allowed.");
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const { user } = await requireSuperAdmin();
    assertSameOrigin(request);
    const id = z.string().uuid().parse((await context.params).id);
    const input = inputSchema.parse(await request.json());
    const business = await readPlatformBusiness(id);
    if (business.name !== input.confirmationName) {
      throw new AccessError(409, "Business name confirmation does not match the current business name.");
    }
    const { error } = await createAdminClient().rpc("platform_restore_business", {
      p_actor: user.id, p_org: id, p_confirmation_name: input.confirmationName,
      p_reason: input.reason, p_request_id: randomUUID(),
    });
    if (error) {
      if (error.code === "P0002") throw new AccessError(404, "Business not found.");
      if (error.code === "42501") throw new AccessError(403, "This business cannot be restored by this account.");
      if (error.code === "55000") throw new AccessError(409, "This business is not in a state that can be restored.");
      if (error.code === "22023") throw new AccessError(400, "Business confirmation or restore reason is invalid.");
      throw platformRpcError(error.code, "Business restore");
    }
    const restored = await readPlatformBusiness(id);
    return Response.json({ ok: true, business: restored }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return platformFailure(error); }
}
