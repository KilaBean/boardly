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
});

/** Server-only secrets. Never import these from a client component. */
const serverEnvBaseSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  LIVEBLOCKS_SECRET_KEY: z
    .string()
    .min(1, "LIVEBLOCKS_SECRET_KEY is required")
    .refine((v) => v.startsWith("sk_"), {
      message: "LIVEBLOCKS_SECRET_KEY must start with 'sk_'",
    }),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * Resend API key. Optional: without it invitations still work, they are just
   * not delivered, and the inviter copies the link instead.
   */
  RESEND_API_KEY: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("re_"), { message: "RESEND_API_KEY must start with 're_'" })
    .optional(),

  /** Sender, as `you@example.com` or `Boardly <you@example.com>`. */
  MAIL_FROM: z
    .string()
    .min(1)
    .refine((v) => /^[^@\s]+@[^@\s]+$/.test(v) || /<[^@\s]+@[^@\s]+>\s*$/.test(v), {
      message: "MAIL_FROM must be an email address, optionally as 'Name <you@example.com>'",
    })
    .optional(),
});

/**
 * Mail is configured as a pair or not at all.
 *
 * Half-configuring it is the dangerous state: a key with no sender silently
 * disables delivery, and invitations would go quietly undelivered while the UI
 * claimed otherwise. Failing at boot is the loud, correct outcome.
 */
export const serverEnvSchema = serverEnvBaseSchema.refine(
  (env) => Boolean(env.RESEND_API_KEY) === Boolean(env.MAIL_FROM),
  {
    message: "RESEND_API_KEY and MAIL_FROM must be set together, or both left unset",
    path: ["MAIL_FROM"],
  },
);

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
