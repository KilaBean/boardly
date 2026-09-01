import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth callback.
 *
 * Handles the two ways Supabase hands control back to us:
 *
 *  - **PKCE** (`?code=`) — OAuth providers and, by default, email links.
 *  - **Token hash** (`?token_hash=&type=`) — email confirmation and password
 *    recovery links when the project is configured to use OTP verification.
 *
 * Supporting both means the route keeps working if the project's email link
 * format is changed in the Supabase dashboard, which is otherwise a confusing
 * "nothing happens when I click the link" failure.
 *
 * The `next` parameter comes from a URL an attacker can craft, so it is passed
 * through `safeRedirectPath` before use — otherwise this becomes an open
 * redirect on an endpoint that has just issued a session cookie.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  /**
   * Redirects with a RELATIVE Location, so the browser resolves them against
   * whatever host the user actually arrived on.
   *
   * Neither `request.nextUrl.origin` nor `request.url` reflects the incoming
   * Host inside a route handler — both resolved to `localhost:3000` for a
   * request made to `127.0.0.1:3000`. That matters more here than anywhere
   * else in the app: this is the response that sets the session cookies, and
   * cookies are scoped to a host. Redirecting to a different origin hands the
   * user a page with no session, which surfaced as "your reset link has
   * expired" immediately after following a perfectly valid link.
   *
   * A relative Location is explicitly allowed (RFC 7231 §7.1.2) and sidesteps
   * the question entirely. Cookie mutations made through `cookies()` are still
   * applied to this response by Next.
   */
  const to = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } });

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get("next"));

  // The provider reports its own failures here (e.g. the user pressed Cancel).
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return to(`/sign-in?error=${encodeURIComponent("sign_in_failed")}`);
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return to(next);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // A recovery link authenticates the user solely so they can choose a new
      // password; send them to the form rather than the dashboard.
      const destination = type === "recovery" ? "/reset-password" : next;
      return to(destination);
    }
  }

  return to(`/sign-in?error=${encodeURIComponent("link_invalid")}`);
}
