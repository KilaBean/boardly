/**
 * Workspace slug generation.
 *
 * The output must satisfy the database constraints exactly, or the insert
 * fails with a constraint violation the user cannot act on:
 *
 *   workspaces_slug_format: ^[a-z0-9]+(-[a-z0-9]+)*$
 *   workspaces_slug_length: 2..48 characters
 *
 * So this function has to cope with everything a workspace name can contain —
 * accents, emoji, CJK, punctuation, or nothing usable at all.
 */

export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 48;

/** Used when a name yields no usable ASCII characters (e.g. "🎨" or "研究室"). */
const FALLBACK_SLUG = "workspace";

/**
 * Converts a display name into a candidate slug.
 *
 * Accents are decomposed and stripped rather than dropped, so "Café Zürich"
 * becomes "cafe-zurich" instead of "caf-zrich".
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    // Strip combining marks left behind by the decomposition.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Anything that is not a-z or 0-9 becomes a separator.
    .replace(/[^a-z0-9]+/g, "-")
    // Collapse runs and trim leading/trailing separators.
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (base.length === 0) return FALLBACK_SLUG;

  if (base.length > SLUG_MAX_LENGTH) {
    // Trim to the limit, then back to a separator boundary so the slug does
    // not end mid-word or with a trailing hyphen.
    const cut = base.slice(0, SLUG_MAX_LENGTH);
    const trimmed = cut.replace(/-[^-]*$/, "").replace(/-$/, "");
    return trimmed.length >= SLUG_MIN_LENGTH ? trimmed : cut.replace(/-$/, "");
  }

  // A single character is valid per the format rule but too short per the
  // length rule; pad rather than reject, since the user gave us a real name.
  if (base.length < SLUG_MIN_LENGTH) return `${base}-1`;

  return base;
}

/**
 * Appends a disambiguating suffix, keeping the result inside the length limit.
 *
 * Used when the generated slug is already taken. The base is truncated from
 * the right so the suffix always survives.
 */
export function withSuffix(slug: string, suffix: number | string): string {
  const tail = `-${suffix}`;
  const room = SLUG_MAX_LENGTH - tail.length;
  const base = slug.slice(0, Math.max(room, 1)).replace(/-$/, "");
  return `${base}${tail}`;
}

/** Cheap local check mirroring the database constraints. */
export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= SLUG_MIN_LENGTH &&
    slug.length <= SLUG_MAX_LENGTH &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
  );
}
