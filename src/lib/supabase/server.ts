import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { clientEnv } from "@/lib/env/client";
import type { Database } from "@/types/database";

/**
 * Request-scoped Supabase client for server components, route handlers and
 * server actions.
 *
 * Create a new one per request — never hoist it to module scope, or one
 * user's session would be reused for another's request.
 *
 * This still uses the anon key, so RLS applies. That is deliberate: server
 * code gets the *user's* permissions by default, and reaching for elevated
 * access has to be an explicit, visible decision (see `admin.ts`).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot set cookies. Middleware refreshes the
            // session instead, so this is safe to swallow — but only because
            // middleware exists. See src/lib/supabase/session.ts.
          }
        },
      },
    },
  );
}
