/**
 * Deterministic collaborator colours.
 *
 * Shared by the auth endpoint (which attaches a colour to the Liveblocks user
 * info) and the presence hook (which colours the cursor), so the same person
 * is the same colour everywhere without round-tripping the value.
 *
 * Colour is decorative. Every surface that uses it also shows the
 * collaborator's name, because colour alone is not an accessible way to
 * distinguish people.
 */
const CURSOR_COLORS = [
  "#E03131",
  "#1971C2",
  "#2F9E44",
  "#F08C00",
  "#9C36B5",
  "#0C8599",
  "#E8590C",
  "#C2255C",
] as const;

/** Stable across sessions and machines: derived only from the user id. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]!;
}

export { CURSOR_COLORS };
