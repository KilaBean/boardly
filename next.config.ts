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
 * exists, which makes setting it by hand a chicken-and-egg problem (and a
 * stale value the next time the domain changes). Vercel supplies
 * `VERCEL_PROJECT_PRODUCTION_URL` — the stable production hostname, the same
 * for every deployment — so it is used as the default.
 *
 * Precedence:
 *   1. An explicit `NEXT_PUBLIC_APP_URL` (local `.env.local`, or a custom
 *      domain set in Vercel) always wins.
 *   2. Otherwise, Vercel's production hostname.
 *   3. Otherwise nothing — and `src/lib/env` fails the build with a message
 *      naming the variable, which is the correct outcome rather than guessing.
 */
const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined);

const nextConfig: NextConfig = {
  // Only set the key when a value exists: an `undefined` here would be inlined
  // as the string "undefined" and pass the URL check for nobody's benefit.
  ...(appUrl ? { env: { NEXT_PUBLIC_APP_URL: appUrl } } : {}),
};

export default nextConfig;
