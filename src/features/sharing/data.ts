import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { BoardRole, WorkspaceRole } from "@/types/database";

/**
 * Membership and invitation reads.
 *
 * All queried through the user's client, so RLS decides visibility. In
 * particular, `invitations_select` restricts pending invitations to workspace
 * admins and board owners, and `token_hash` carries no grant at all — a member
 * cannot read one and reconstruct an invite URL.
 */

export type MemberProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type BoardMemberEntry = MemberProfile & { role: BoardRole };
export type WorkspaceMemberEntry = MemberProfile & { role: WorkspaceRole; joinedAt: string };

type ProfileJoin = { id: string; display_name: string; avatar_url: string | null } | null;

export async function listBoardMembers(boardId: string): Promise<BoardMemberEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("board_members")
    .select("user_id, role, profiles!inner(id, display_name, avatar_url)")
    .eq("board_id", boardId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.flatMap((row) => {
    const profile = row.profiles as unknown as ProfileJoin;
    if (!profile) return [];
    return [
      {
        userId: row.user_id,
        role: row.role,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
      },
    ];
  });
}

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, joined_at, profiles!inner(id, display_name, avatar_url)")
    .eq("workspace_id", workspaceId)
    .order("joined_at", { ascending: true });

  if (error || !data) return [];

  return data.flatMap((row) => {
    const profile = row.profiles as unknown as ProfileJoin;
    if (!profile) return [];
    return [
      {
        userId: row.user_id,
        role: row.role,
        joinedAt: row.joined_at,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
      },
    ];
  });
}

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  boardId: string | null;
};

/** Outstanding invitations. Never includes the token or its hash. */
export async function listPendingInvitations(
  workspaceId: string,
  boardId?: string,
): Promise<PendingInvitation[]> {
  const supabase = await createClient();

  let query = supabase
    .from("invitations")
    .select("id, email, role, expires_at, board_id")
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  query = boardId ? query.eq("board_id", boardId) : query.is("board_id", null);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    boardId: row.board_id,
  }));
}

/**
 * Whether a board currently has an active share link.
 *
 * Note there is no way to return the *URL*: only the token's hash is stored,
 * by design. An owner who loses the link must regenerate it, which also
 * revokes the old one.
 */
export async function getShareLinkState(
  boardId: string,
): Promise<{ enabled: boolean; role: "editor" | "viewer" }> {
  const supabase = await createClient();

  // Both columns are mirrored onto `boards` by a trigger and carry no UPDATE
  // grant, so reading them here cannot be spoofed by a client.
  const { data } = await supabase
    .from("boards")
    .select("share_link_enabled, share_link_role")
    .eq("id", boardId)
    .maybeSingle();

  return {
    enabled: data?.share_link_enabled ?? false,
    role: (data?.share_link_role as "editor" | "viewer" | null) ?? "viewer",
  };
}
