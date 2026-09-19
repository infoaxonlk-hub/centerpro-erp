import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role,is_active").eq("id", user.id).single();
  if (!profile?.is_active) redirect("/login?error=Your account is inactive");
  return <AppShell name={profile.full_name} role={profile.role}>{children}</AppShell>;
}
