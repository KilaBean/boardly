import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. **BYPASSES ROW LEVEL SECURITY COMPLETELY.**
 *
 * Every policy in `supabase/migrations/` is inert for this client. It exists
 * for the few operations that legitimately cannot run as the user:
 *
 *   - accepting an invitation (verify token hash, then create the membership
 *     the invitee does not yet have permission to create)
 *   - transferring workspace ownership
 *   - administrative cleanup
 *
 * Rules for using it:
 *   1. Authenticate and authorize the caller FIRST, with the normal client.
 *   2. Scope the query as narrowly as the operation allows.
 *   3. Never pass user-supplied filters straight through — an unfiltered
 *      `.eq()` built from request input is a full-table read here.
 *
 * The `server-only` import above makes importing this from a client component
 * a build failure rather than a catastrophic key leak.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
