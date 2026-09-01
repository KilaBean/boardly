import "server-only";

import { cache } from "react";

import { getUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { BoardRole, BoardVisibility } from "@/types/database";

/**
 * Server-side board reads.
 *
 * Visibility is decided entirely by RLS (`can_view_board`), so these queries
 * never filter by membership themselves. A private board simply does not
 * appear in the result set for a user who was not granted access.
 */

export type BoardSummary = {
  id: string;
  workspaceId: string;
  name: string;
  ownerId: string;
  visibility: BoardVisibility;
  shareLinkEnabled: boolean;
  updatedAt: string;
  archivedAt: string | null;
};

type BoardRow = {
  id: string;
  workspace_id: string;
  name: string;
  owner_id: string;
  visibility: BoardVisibility;
  share_link_enabled: boolean;
  updated_at: string;
  archived_at: string | null;
};

function toSummary(row: BoardRow): BoardSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    ownerId: row.owner_id,
    visibility: row.visibility,
    shareLinkEnabled: row.share_link_enabled,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

const BOARD_COLUMNS =
  "id, workspace_id, name, owner_id, visibility, share_link_enabled, updated_at, archived_at";

export type ListBoardsOptions = {
  /** Include archived boards. Defaults to false. */
  includeArchived?: boolean;
  limit?: number;
};

export async function listBoards(
  workspaceId: string,
  options: ListBoardsOptions = {},
): Promise<BoardSummary[]> {
  const supabase = await createClient();

  let query = supabase
    .from("boards")
    .select(BOARD_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (!options.includeArchived) {
    query = query.is("archived_at", null);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as BoardRow[]).map(toSummary);
}

/** Most recently touched boards across every workspace the user can see. */
export const listRecentBoards = cache(async (limit = 6): Promise<BoardSummary[]> => {
  const user = await getUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .select(BOARD_COLUMNS)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as BoardRow[]).map(toSummary);
});

export type BoardDetail = BoardSummary & {
  /** The signed-in user's effective role, resolved by SQL. */
  role: BoardRole | null;
};

/**
 * A single board plus the caller's effective role.
 *
 * The role comes from `board_access_role()` — the same function the policies
 * use — rather than being recomputed here, so the UI cannot disagree with the
 * database about what the user may do.
 */
export const getBoard = cache(async (boardId: string): Promise<BoardDetail | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("boards")
    .select(BOARD_COLUMNS)
    .eq("id", boardId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: role } = await supabase.rpc("board_access_role", { p_board_id: boardId });

  return { ...toSummary(data as BoardRow), role: (role as BoardRole | null) ?? null };
});
