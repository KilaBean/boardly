import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads `.env.local` into `process.env` for Playwright's own process.
 *
 * Next.js loads `.env.local` for the app under test, but Playwright's config
 * and setup files run in a separate Node process that gets no such treatment.
 * Seeding users needs the service-role key, so the file is parsed here.
 *
 * Deliberately minimal rather than pulling in `dotenv`: this understands
 * `KEY=value` with optional quotes, which is all `.env.local` contains.
 * Existing environment variables win, so CI can override without editing files.
 */
export function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (key.length === 0 || process.env[key] !== undefined) continue;

    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

/** Reads a required variable, failing loudly rather than producing odd errors later. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Authenticated E2E tests need a running Supabase instance — ` +
        `run \`supabase start\` and copy its keys into .env.local.`,
    );
  }
  return value;
}
