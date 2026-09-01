import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env/client";
import type { Database } from "@/types/database";

/**
 * Supabase client for browser/client components.
 *
 * Uses the anon key, which is safe to expose *only* because Row Level
 * Security is enabled on every table. Any query issued here is still subject
 * to the policies in `supabase/migrations/`.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
