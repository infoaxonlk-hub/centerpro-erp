import { requireSuperAdmin } from "@/lib/business-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { decorateBusiness, businessSelect, createBusinessSchema, platformFailure, provisionPermissions } from "@/lib/platform-businesses";

export async function GET() {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();
    const records: unknown[] = [];
    for (let offset=0;;offset+=200) {
      const { data, error } = await admin.from("organizations").select(businessSelect).order("created_at", { ascending: false }).order("id").range(offset,offset+199);
      if (error) throw new Error("Could not load business records.");
      records.push(...(data ?? []));
      if (!data || data.length<200) break;
    }
    return Response.json(records.map(decorateBusiness),{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return platformFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { user } = await requireSuperAdmin();
    const input = createBusinessSchema.parse(await request.json());
    const admin = createAdminClient();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: input.adminEmail, password: input.password, email_confirm: true,
      user_metadata: { full_name: input.adminName },
    });
    if (authError || !created.user) {
      return Response.json({ error: "Could not create the administrator. Check that the email is unique and the password meets your authentication policy." }, { status: 400 });
    }
    const { data: id, error } = await admin.rpc("platform_provision_business", {
      p_actor: user.id, p_admin: created.user.id, p_admin_name: input.adminName, p_admin_email: input.adminEmail,
      p_permissions: provisionPermissions(input.modules), p_details: input.details,
      p_subscription: input.subscription, p_modules: input.modules,
    });
    if (error || !id) {
      // Organization, configuration, profile and audit are one DB transaction.
      const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
      if (cleanupError) console.error("Orphan Auth user cleanup required", { userId: created.user.id });
      throw new Error("Business provisioning transaction failed.");
    }
    return Response.json({ id, name: input.details.name, adminEmail: input.adminEmail }, { status: 201 });
  } catch (error) { return platformFailure(error); }
}
