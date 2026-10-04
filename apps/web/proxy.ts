import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, newNonce } from "./lib/security";

/**
 * Refreshes the Supabase session cookies on every page request (the @supabase/ssr pattern) and
 * sends signed-out visitors of app pages to sign-in. Authorization itself happens in the pages
 * and actions (lib/auth.ts); this is only the session plumbing. It also sets the per-request
 * Content-Security-Policy nonce (NFR-9): Next.js reads it from the request header and adds it to
 * its own scripts.
 */
const PUBLIC = [/^\/auth(\/|$)/, /^\/privacy$/, /^\/api\/health$/];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const csp = contentSecurityPolicy({
    nonce: newNonce(),
    supabaseUrl: url,
    dev: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
  });
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const next = () => NextResponse.next({ request: { headers } });
  const secured = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  let response = next();
  if (!url || !key) return secured(response);

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        // Forward the refreshed cookies to this render as well as to the browser.
        headers.set("cookie", request.cookies.toString());
        response = next();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!data.user && !PUBLIC.some((p) => p.test(path)) && !path.startsWith("/api/")) {
    // /admin answers 404 to strangers (FR-1.6); everything else asks them to sign in.
    if (path.startsWith("/admin")) return secured(response);
    const target = request.nextUrl.clone();
    target.pathname = "/auth/sign-in";
    target.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(target);
  }
  return secured(response);
}

export const config = {
  matcher: [
    // Pages and API routes; static assets carry only the static headers from next.config.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
