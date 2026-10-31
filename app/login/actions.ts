"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  const {data:profile,error:profileError}=await supabase.from("profiles").select("role,is_active").eq("id",data.user.id).maybeSingle();
  if(profileError)redirect("/login?error=Your profile could not be verified. Please retry");
  if(!profile?.is_active)redirect("/login?error=Your account is inactive or unavailable");
  revalidatePath("/", "layout");
  redirect(profile.role==="super_admin"?"/dashboard/businesses":"/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
