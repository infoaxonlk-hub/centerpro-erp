import "./businesses.css";
import "@/app/company-profile.css";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { BusinessManager } from "./business-manager";

export default async function BusinessesPage() {
  const { profile } = await requirePermission("users");
  if (profile.role !== "super_admin") redirect("/dashboard?error=Access denied");
  return <BusinessManager />;
}
