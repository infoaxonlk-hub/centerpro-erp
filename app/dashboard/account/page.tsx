import { redirect } from "next/navigation";
import { requireAuthenticatedProfile, readBusinessAccess } from "@/lib/business-access";
import { suspensionMessage } from "@/lib/business-modules";
import { SupportContact } from "@/components/support-contact";
export default async function AccountPage() {
  let context;
  try { context = await requireAuthenticatedProfile(); } catch { redirect("/login?error=Your account is inactive or unavailable"); }
  const business = await readBusinessAccess(context.supabase);
  return <section className="panel access-status"><h1>Business account</h1><h2>{business.businessName}</h2>
    <p role="status">{business.reason==="suspended" ? suspensionMessage : !business.operational
      ? "Your subscription does not currently permit business operations. Please contact InfoAxon Support to renew or update your subscription."
      : "Your business account is active."}</p>
    <dl><dt>Business status</dt><dd>{business.businessStatus}</dd><dt>Plan</dt><dd>{business.subscription.plan}</dd>
      <dt>Subscription status</dt><dd>{business.subscription.status}</dd><dt>Expiration date</dt><dd>{business.subscription.expires_on ?? "No expiration date"}</dd>
      <dt>Business ID</dt><dd>{business.organizationId}</dd></dl><SupportContact/>
  </section>;
}
