import { z } from "zod";

/**
 * Environment schemas.
 *
 * Split into `client` (safe to inline into the browser bundle) and `server`
 * (secrets that must never leave the server). Keeping the schemas in one file
 * lets us validate both from a single place while still exposing them through
 * two separate entrypoints with different import guards.
 */

/** Variables that are inlined into the client bundle. Must be NEXT_PUBLIC_*. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.url({ message: "NEXT_PUBLIC_APP_URL must be a valid URL" }),
  /**
   * tldraw license key.
   *
   * Optional, because the canvas runs unlicensed on localhost — but on any
   * other domain tldraw resolves to `unlicensed-production`, renders for five
   * seconds and then removes the editor from the page (see `LicenseProvider`
   * and `LICENSE_TIMEOUT` in @tldraw/editor). Without this set, a deployed
   * board loads and then goes blank.
   */
  NEXT_PUBLIC_TLDRAW_LICENSE_KEY: z.string().min(1).optional(),
});

/** Server-only secrets. Never import these from a client component. */
export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  LIVEBLOCKS_SECRET_KEY: z
    .string()
    .min(1, "LIVEBLOCKS_SECRET_KEY is required")
    .refine((v) => v.startsWith("sk_"), {
      message: "LIVEBLOCKS_SECRET_KEY must start with 'sk_'",
    }),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Formats a Zod error into a readable, multi-line message.
 * Deliberately prints only variable names and messages, never values, so a
 * malformed secret can't leak into logs or a build transcript.
 */
export function formatEnvError(error: z.ZodError, scope: string): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.join(".") || "(root)";
    return `  - ${key}: ${issue.message}`;
  });
  return `Invalid ${scope} environment configuration:\n${lines.join("\n")}\n\nSee .env.example for the expected variables.`;
}
