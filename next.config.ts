import type { NextConfig } from "next";

/**
 * Canonical application URL.
 *
 * `NEXT_PUBLIC_APP_URL` is baked into the bundle at build time and is what
 * invitation links, share links and the OAuth redirect are built from — so a
 * wrong value does not fail loudly, it silently mints links pointing at the
 * wrong host.
 *
 * On Vercel the production domain is not known until the first deployment
 * exists, which makes setting it by hand a chicken-and-egg problem. Vercel
 * supplies `VERCEL_PROJECT_PRODUCTION_URL` — the stable production hostname,
 * identical for every deployment — so that is the default.
 *
 * Precedence:
 *   1. An explicit `NEXT_PUBLIC_APP_URL`, unless it is a loopback address on a
 *      deployed environment (see below).
 *   2. Vercel's production hostname.
 *   3. Nothing — and `src/lib/env` fails the build naming the variable, which
 *      is the right outcome rather than guessing.
 */
const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");

const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : undefined;

/** `http://localhost:3000`, `http://127.0.0.1:3000`, `http://[::1]:3000`, … */
function isLoopback(url: string | undefined): boolean {
  return !!url && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(url);
}

/**
 * A loopback URL is never correct once deployed.
 *
 * This is not hypothetical: copying the five Supabase/Liveblocks values from
 * `.env.local` into Vercel also carried `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000`
 * across, and production then minted share links pointing at the recipient's
 * own machine. Since this value is used to build links that are sent to other
 * people, the failure is silent and lands on someone else — so a loopback
 * value is ignored wherever a real deployment hostname is available.
 */
const appUrl = vercelUrl && isLoopback(explicit) ? vercelUrl : (explicit ?? vercelUrl);

const nextConfig: NextConfig = {
  // Only set the key when a value exists: `undefined` would be inlined as the
  // string "undefined" and pass a truthiness check for nobody's benefit.
  ...(appUrl ? { env: { NEXT_PUBLIC_APP_URL: appUrl } } : {}),
};

export default nextConfig;
