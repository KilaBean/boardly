import type { ActivityEventType, Json } from "@/types/database";

export { relativeTime } from "@/lib/time";

/**
 * Turns an activity row into a sentence.
 *
 * Pure and free of React so it can be unit tested — the interesting cases are
 * the defensive ones: `actor_id` is `ON DELETE SET NULL`, so the audit trail
 * outlives the account and every message must survive a null actor. Metadata
 * is untyped `jsonb` written by earlier versions of the app, so nothing in it
 * can be assumed present or well-typed.
 */

export type ActivityDescriptor = {
  /** Who acted. "Someone" when the account has since been deleted. */
  actor: string;
  /** What they did, without the actor. */
  action: string;
};

/** Reads a string field from untyped jsonb metadata. */
function metaString(metadata: Json | null | undefined, key: string): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, Json | undefined>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

const DELETED_ACTOR = "Someone";

export function describeActivity(
  eventType: ActivityEventType,
  actorName: string | null,
  metadata: Json | null,
): ActivityDescriptor {
  const actor = actorName?.trim() || DELETED_ACTOR;
  const name = metaString(metadata, "name");
  const role = metaString(metadata, "role");
  const visibility = metaString(metadata, "visibility");
  const scope = metaString(metadata, "scope");

  switch (eventType) {
    case "board.created":
      return { actor, action: name ? `created “${name}”` : "created a board" };
    case "board.renamed":
      return { actor, action: name ? `renamed a board to “${name}”` : "renamed a board" };
    case "board.archived":
      return { actor, action: name ? `archived “${name}”` : "archived a board" };
    case "board.restored":
      return { actor, action: name ? `restored “${name}”` : "restored a board" };
    case "board.deleted":
      return { actor, action: name ? `deleted “${name}”` : "deleted a board" };
    case "board.visibility_changed":
      return {
        actor,
        action:
          visibility === "private"
            ? "made a board private"
            : visibility === "workspace"
              ? "made a board visible to the workspace"
              : "changed a board's visibility",
      };
    case "board.shared":
      return { actor, action: "changed a board's share link" };
    case "member.invited":
      // Deliberately no email: the activity feed is visible to every workspace
      // member, and who was invited is not their business until they join.
      return { actor, action: role ? `invited someone as ${role}` : "invited someone" };
    case "member.joined":
      return { actor, action: role && role !== "owner" ? `joined as ${role}` : "joined" };
    case "member.removed":
      return {
        actor,
        action: scope === "board" ? "removed someone from a board" : "removed someone",
      };
    case "member.role_changed":
      return {
        actor,
        action: role ? `changed someone's role to ${role}` : "changed someone's role",
      };
    case "comment.created":
      return { actor, action: "left a comment" };
    case "comment.resolved":
      return { actor, action: "resolved a comment" };
    default: {
      // Exhaustiveness guard: a new enum value fails typecheck here rather
      // than rendering an empty row in production.
      const exhaustive: never = eventType;
      void exhaustive;
      return { actor, action: "did something" };
    }
  }
}
