/**
 * Cache headers for per-user API responses.
 *
 * Every route under `/api` answers differently depending on who is asking, so
 * none of it may be held by a shared cache.
 *
 * This exists because setting the header only on the success path is not
 * enough. A `401` or `403` returned without any `Cache-Control` inherits the
 * platform default — on Vercel that is `public, max-age=0, must-revalidate`,
 * which marks an authorization-dependent response as publicly cacheable. It
 * was invisible locally, where the default differs, and only showed up when
 * the E2E suite was pointed at the deployed site.
 *
 * The worst case was `/api/liveblocks-auth`, whose success response carries a
 * room access token and set no cache header at all.
 */
export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

/** Header bag for a JSON response, merging in anything caller-specific. */
export function noStore(extra?: Record<string, string>): Record<string, string> {
  return { ...NO_STORE_HEADERS, ...extra };
}
