import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {sessionFailureStatus} from "@/lib/auth-status";

export async function proxy(request: NextRequest) {
  const forwarded = new Headers(request.headers);
  // Always overwrite the client-supplied value. Server guards use the actual URL.
  forwarded.set("x-centerpro-path", request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: forwarded } });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        forwarded.set("cookie", request.headers.get("cookie") ?? "");
        response = NextResponse.next({ request: { headers: forwarded } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user },error } = await supabase.auth.getUser();
  function preserveSession(target:NextResponse){
    response.cookies.getAll().forEach(cookie=>target.cookies.set(cookie));
    target.headers.set("Cache-Control","private, no-store");
    return target;
  }
  if(!user&&error&&sessionFailureStatus(error)===503&&request.nextUrl.pathname!=="/login")return preserveSession(NextResponse.json({error:"Session verification is temporarily unavailable. Please retry."},{status:503}));
  if (request.nextUrl.pathname.startsWith("/dashboard") && !user) return preserveSession(NextResponse.redirect(new URL("/login", request.url)));
  if (request.nextUrl.pathname === "/login" && user && !request.nextUrl.searchParams.has("error")) return preserveSession(NextResponse.redirect(new URL("/dashboard", request.url)));
  response.headers.set("Cache-Control","private, no-store");
  return response;
}
export const config = { matcher: ["/dashboard/:path*", "/login", "/api/business-access"] };
