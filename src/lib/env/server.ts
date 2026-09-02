import "server-only";

import { formatEnvError, serverEnvSchema } from "./schema";

/**
 * Server-only environment.
 *
 * The `server-only` import makes any client component that reaches this module
 * fail at build time rather than shipping a service-role key to the browser.
 * That build-time failure is the point: it turns a catastrophic leak into a
 * compile error.
 */
const parsed = serverEnvSchema.safeParse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  LIVEBLOCKS_SECRET_KEY: process.env.LIVEBLOCKS_SECRET_KEY,
  NODE_ENV: process.env.NODE_ENV,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM,
});

if (!parsed.success) {
  throw new Error(formatEnvError(parsed.error, "server"));
}

export const serverEnv = parsed.data;
