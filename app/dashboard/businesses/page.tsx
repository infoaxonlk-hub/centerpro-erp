import "./businesses.css";
import "@/app/company-profile.css";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/business-access";
import { BusinessManager } from "./business-manager";
export default async function BusinessesPage() {
  let actor;
  try { actor=await requireSuperAdmin(); } catch { redirect("/dashboard?error=Access denied"); }
  return <BusinessManager actorId={actor.user.id} ownOrganizationId={actor.profile.organization_id}/>;
}
