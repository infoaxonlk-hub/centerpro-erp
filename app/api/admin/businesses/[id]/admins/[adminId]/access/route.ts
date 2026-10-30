import { z } from "zod";
import { requireSuperAdmin, AccessError } from "@/lib/business-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformFailure,platformRpcError } from "@/lib/platform-businesses";

type Context = { params: Promise<{ id: string; adminId: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    const { user } = await requireSuperAdmin();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new AccessError(403, "Request origin is not allowed.");
    const input = z.object({ id: z.string().uuid(), adminId: z.string().uuid() }).parse(await params);
    const { data, error } = await createAdminClient().rpc("platform_grant_business_admin_access", {
      p_actor: user.id, p_org: input.id, p_admin: input.adminId,
    });
    if (error) {
      if (error.code === "P0002") throw new AccessError(404, "Active business administrator not found.");
      if (error.code === "42501") throw new AccessError(403, "Platform administrator access required.");
      throw platformRpcError(error.code,"Administrator access grant");
    }
    return Response.json({ permissions: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return platformFailure(error); }
}
