import { clientEnvSchema, formatEnvError } from "./schema";

/**
 * Public environment, safe for the browser.
 *
 * Each variable is referenced as a static `process.env.X` property access.
 * Next.js only inlines NEXT_PUBLIC_* vars when it can see them literally in the
 * source, so this object cannot be built dynamically from a key list.
 */
const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY: process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

if (!parsed.success) {
  throw new Error(formatEnvError(parsed.error, "public"));
}

export const clientEnv = parsed.data;
