/**
 * Safe handling of post-authentication redirect targets.
 *
 * Sign-in carries a `?next=` parameter so a user who was bounced off a
 * protected page lands back on it. That parameter is attacker-controllable:
 * a link like `/sign-in?next=https://evil.example/login` produces a covert
 * redirect from our own domain, which is exactly what phishing wants — the
 * victim sees a legitimate origin before being handed to the attacker.
 *
 * Only same-origin, path-absolute targets are allowed through.
 */

export const DEFAULT_REDIRECT = "/dashboard";

/** Matches ASCII control characters, including CR, LF and NUL. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Returns `candidate` when it is a safe internal path, otherwise the fallback.
 *
 * Rejects, in order of how easy each is to overlook:
 *  - absolute URLs (`https://evil.example`)
 *  - scheme-relative URLs (`//evil.example`) — browsers treat these as absolute
 *  - backslash variants (`/\evil.example`) and their percent-encodings, since
 *    some parsers normalise `\` to `/` and smuggle past a naive
 *    `startsWith("/")` check
 *  - anything not starting with `/`
 *  - control characters, which enable header/log injection
 */
export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (typeof candidate !== "string") return fallback;

  const value = candidate.trim();
  if (value.length === 0) return fallback;
  if (CONTROL_CHARACTERS.test(value)) return fallback;

  // Must be path-absolute.
  if (!value.startsWith("/")) return fallback;

  // Reject scheme-relative and backslash-smuggled authority forms.
  const lowered = value.toLowerCase();
  if (
    lowered.startsWith("//") ||
    lowered.startsWith("/\\") ||
    lowered.startsWith("/%2f") ||
    lowered.startsWith("/%5c")
  ) {
    return fallback;
  }

  return value;
}

/** Builds a sign-in URL that returns the user to `from` after authenticating. */
export function signInUrlFor(from: string): string {
  const safe = safeRedirectPath(from, "/");
  return `/sign-in?next=${encodeURIComponent(safe)}`;
}
