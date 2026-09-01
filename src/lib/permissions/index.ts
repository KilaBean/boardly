import type { BoardRole, BoardVisibility, WorkspaceRole } from "@/types/database";

/**
 * Permission rules mirrored from SQL into TypeScript.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS NOT THE SECURITY BOUNDARY.
 *
 * Row Level Security in `supabase/migrations/` is the boundary, and it is
 * what actually stops a malicious request. These functions decide whether to
 * render a "Delete board" button — nothing more. Never use them to *permit*
 * an operation; the database independently re-checks every one.
 *
 * They exist so the UI does not offer actions that would then fail, and so
 * the rules are expressible in tests without a database round trip. The
 * matching RLS behaviour is proven in tests/integration/rls.test.ts.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const WORKSPACE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export function isWorkspaceAdmin(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canRenameWorkspace(role: WorkspaceRole | null): boolean {
  return isWorkspaceAdmin(role);
}

export function canDeleteWorkspace(role: WorkspaceRole | null): boolean {
  return role === "owner";
}

export function canInviteToWorkspace(role: WorkspaceRole | null): boolean {
  return isWorkspaceAdmin(role);
}

/**
 * Whether `actor` may set `target`'s role to `nextRole`.
 *
 * Ownership is deliberately not assignable here: exactly one owner exists per
 * workspace (enforced by a unique index), and transfer is a server-side
 * operation. Mirrors the `role <> 'owner'` clauses on workspace_members.
 */
export function canAssignWorkspaceRole(
  actorRole: WorkspaceRole | null,
  targetRole: WorkspaceRole | null,
  nextRole: WorkspaceRole,
): boolean {
  if (!isWorkspaceAdmin(actorRole)) return false;
  if (nextRole === "owner") return false;
  if (targetRole === "owner") return false;
  return true;
}

export function canRemoveWorkspaceMember(
  actorRole: WorkspaceRole | null,
  targetRole: WorkspaceRole | null,
  isSelf: boolean,
): boolean {
  if (targetRole === "owner") return false;
  return isWorkspaceAdmin(actorRole) || isSelf;
}

export function outranksWorkspaceRole(a: WorkspaceRole, b: WorkspaceRole): boolean {
  return WORKSPACE_RANK[a] > WORKSPACE_RANK[b];
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export type BoardAccessContext = {
  userId: string;
  ownerId: string;
  visibility: BoardVisibility;
  archivedAt: string | null;
  /** Explicit board_members role, if any. */
  explicitRole: BoardRole | null;
  /** Whether the user belongs to the board's workspace. */
  isWorkspaceMember: boolean;
};

/**
 * Effective board role, in the same precedence order as
 * `public.board_access_role()`:
 *
 *   1. board owner                                  -> editor
 *   2. explicit board_members row                   -> that role
 *   3. workspace-visible board + workspace member   -> editor
 *   4. otherwise                                    -> null
 *
 * Step 2 preceding step 3 is what lets a board be shared read-only with one
 * person inside a workspace everybody else can edit.
 */
export function resolveBoardRole(ctx: BoardAccessContext): BoardRole | null {
  if (ctx.ownerId === ctx.userId) return "editor";
  if (ctx.explicitRole !== null) return ctx.explicitRole;
  if (ctx.visibility === "workspace" && ctx.isWorkspaceMember) return "editor";
  return null;
}

export function canViewBoard(ctx: BoardAccessContext): boolean {
  return resolveBoardRole(ctx) !== null;
}

/** Content edit rights. An archived board is read-only. */
export function canEditBoard(ctx: BoardAccessContext): boolean {
  if (ctx.archivedAt !== null) return false;
  return resolveBoardRole(ctx) === "editor";
}

export function isBoardOwner(ctx: BoardAccessContext): boolean {
  return ctx.ownerId === ctx.userId;
}

/** Renaming, sharing, archiving and deleting are owner-only. */
export function canManageBoard(ctx: BoardAccessContext): boolean {
  return isBoardOwner(ctx);
}

/** Viewers may still discuss the board; commenting is not board content. */
export function canComment(ctx: BoardAccessContext): boolean {
  return canViewBoard(ctx);
}

export function canResolveComment(ctx: BoardAccessContext, commentAuthorId: string): boolean {
  return ctx.userId === commentAuthorId || canEditBoard(ctx);
}

export function canEditCommentBody(ctx: BoardAccessContext, commentAuthorId: string): boolean {
  return ctx.userId === commentAuthorId;
}
