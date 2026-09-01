import { NextResponse, type NextRequest } from "next/server";

import { signInUrlFor } from "@/lib/auth/redirect";
import { updateSession } from "@/lib/supabase/session";

/**
 * Next 16 renamed the `middleware` file convention to `proxy`. Same
 * capabilities, new name and export — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 *
 * Two jobs, in this order:
 *
 *   1. Refresh the Supabase session and write rotated auth cookies onto the
 *      response. Skipping this causes random logouts, because server
 *      components cannot set cookies themselves.
 *   2. Perform an OPTIMISTIC redirect for unauthenticated visitors.
 *
 * Step 2 is a user-experience optimisation, not a security control. Proxy runs
 * on prefetches too, so it must stay cheap and must not query the database.
 * The authoritative check is `requireUser()` in the Data Access Layer, and
 * beneath that, Row Level Security. If this file were deleted entirely, no
 * data would leak — pages would just render before redirecting.
 */

/** Routes that require a session. Prefix-matched. */
// NOTE: "/share" is deliberately absent — it is the one public route.
const PROTECTED_PREFIXES = ["/dashboard", "/board", "/w", "/onboarding", "/invite"];

/** Auth routes a signed-in user has no reason to see. */
const AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!user && isProtected(pathname)) {
    // Built from `request.url`, not `nextUrl`: `nextUrl.origin` does not
    // reflect the incoming Host (it reported localhost for a 127.0.0.1
    // request), and bouncing the user to a different origin loses their
    // cookies. See the note in src/app/auth/callback/route.ts.
    const target = signInUrlFor(`${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(new URL(target, request.url));
  }

  // `/reset-password` is deliberately absent: arriving there means the user
  // has just consumed a recovery link and IS authenticated, so bouncing them
  // away would make password reset impossible.
  if (user && AUTH_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  /**
   * Everything except static assets. Auth needs the session refreshed on all
   * real navigations, so the matcher excludes only things that never carry a
   * meaningful session.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
