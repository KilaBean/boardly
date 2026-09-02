/**
 * Invitation constants shared by the server and the browser.
 *
 * Separate from `token.ts` because that module is `server-only` — it handles
 * raw tokens — while the expiry window is ordinary copy the invite dialog has
 * to state. Keeping one source for it means the UI cannot drift from the
 * value the database actually enforces.
 */

/** How long an invitation remains usable. */
export const INVITATION_TTL_DAYS = 7;
