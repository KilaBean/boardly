import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { clientEnv } from "@/lib/env/client";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase session on every matched request and writes any
 * rotated auth cookies onto the outgoing response.
 *
 * Server components cannot set cookies, so without this the refresh token
 * would rotate in memory and be lost — producing random logouts that are
 * miserable to debug.
 *
 * Called from `src/proxy.ts` (Next 16 renamed the `middleware` convention to
 * `proxy`).
 *
 * Two ordering rules matter here and are easy to break:
 *
 *   1. Do not run other logic between `createServerClient` and `getUser()`.
 *      `getUser()` is what triggers the refresh; anything in between can see
 *      a stale session.
 *   2. Always return *this* response object. Constructing a fresh
 *      `NextResponse` later discards the refreshed cookies.
 *
 * Route protection lives in `src/proxy.ts`; this helper only maintains the
 * session and reports who the request belongs to.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
