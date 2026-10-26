import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
  const { data: { user } } = await supabase.auth.getUser();
  if (request.nextUrl.pathname.startsWith("/dashboard") && !user) return NextResponse.redirect(new URL("/login", request.url));
  if (request.nextUrl.pathname === "/login" && user && !request.nextUrl.searchParams.has("error")) return NextResponse.redirect(new URL("/dashboard", request.url));
  return response;
}
export const config = { matcher: ["/dashboard/:path*", "/login"] };
