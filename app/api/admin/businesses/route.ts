import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allPermissions } from "@/lib/access";

async function requireSuperAdmin() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { data: profile, error } = await client.from("profiles").select("role,is_active").eq("id", user.id).single();
  if (error || !profile?.is_active || profile.role !== "super_admin") throw new Error("FORBIDDEN");
  return user;
}
const schema = z.object({
  name: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
});
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Business request failed";
  return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
}
export async function GET() {
  try {
    await requireSuperAdmin();
    const { data, error } = await createAdminClient().from("organizations").select("id,name,created_at,profiles(id,full_name,email,role,is_active)").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireSuperAdmin();
    const input = schema.parse(await request.json());
    const admin = createAdminClient();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: input.email, password: input.password, email_confirm: true,
      user_metadata: { full_name: input.adminName },
    });
    if (authError || !created.user) throw new Error(authError?.message ?? "Admin creation failed");
    let organizationId: string | undefined;
    try {
      const { data: organization, error } = await admin.from("organizations").insert({ name: input.name }).select("id").single();
      if (error || !organization) throw new Error(error?.message ?? "Business creation failed");
      organizationId = organization.id;
      const { error: profileError } = await admin.from("profiles").insert({
        id: created.user.id, organization_id: organization.id, full_name: input.adminName,
        email: input.email, role: "admin", permissions: [...allPermissions],
      });
      if (profileError) throw new Error(profileError.message);
      const { error: auditError } = await admin.from("audit_logs").insert({
        organization_id: organization.id, actor_id: actor.id, action: "business_created",
        entity_type: "organization", entity_id: organization.id,
        after_data: { name: input.name, admin_id: created.user.id, admin_email: input.email },
      });
      if (auditError) throw new Error(auditError.message);
      return NextResponse.json({ id: organization.id, name: input.name, adminEmail: input.email }, { status: 201 });
    } catch (error) {
      const cleanupErrors: string[] = [];
      const { error: userError } = await admin.auth.admin.deleteUser(created.user.id);
      if (userError) cleanupErrors.push(userError.message);
      if (organizationId) {
        const { error: orgError } = await admin.from("organizations").delete().eq("id", organizationId);
        if (orgError) cleanupErrors.push(orgError.message);
      }
      if (cleanupErrors.length) console.error("Business provisioning cleanup failed", { organizationId, userId: created.user.id, cleanupErrors });
      throw error;
    }
  } catch (error) { return failure(error); }
}
