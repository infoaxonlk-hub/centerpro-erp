import { redirect } from "next/navigation";
import { requireAuthenticatedProfile, readBusinessAccess,AccessError } from "@/lib/business-access";
import Link from "next/link";
import {businessAccessMessage} from "@/lib/business-access-reason";
import { SupportContact } from "@/components/support-contact";
export default async function AccountPage() {
  let context;
  try { context = await requireAuthenticatedProfile(); } catch(error) { if(error instanceof AccessError&&error.status>=500)throw error;redirect("/login?error=Your account is inactive or unavailable"); }
  const business = await readBusinessAccess(context.supabase);
  return <section className="panel access-status"><h1>Business account</h1><h2>{business.businessName}</h2>
    <p role="status">{businessAccessMessage(business)}</p>
    <dl><dt>Business status</dt><dd>{business.businessStatus}</dd><dt>Plan</dt><dd>{business.subscription.plan}</dd>
      <dt>Operational access</dt><dd>{business.operational?"Allowed":"Blocked"}</dd><dt>Subscription starts</dt><dd>{business.subscription.starts_on??"Not configured"}</dd><dt>Trial ends</dt><dd>{business.subscription.trial_ends_on??"Not configured / not a trial"}</dd><dt>Subscription status</dt><dd>{business.subscription.status}</dd><dt>Expiration date</dt><dd>{business.subscription.expires_on ?? "No expiration date"}</dd>
      <dt>Business ID</dt><dd>{business.organizationId}</dd></dl>{business.operational&&<a className="primary" href="/dashboard">Open business workspace</a>}{context.profile.role==="super_admin"&&<Link className="ghost" href="/dashboard/businesses">Manage business subscription</Link>}<SupportContact/>
  </section>;
}
