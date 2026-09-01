import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Comment reads.
 *
 * `comments_select` requires `can_view_board`, so a user without board access
 * receives an empty list rather than an error — no membership check is
 * repeated here.
 *
 * Pagination is keyset, not offset: a comment thread grows while you read it,
 * and `offset` would skip or repeat rows as earlier comments arrive. The PRD
 * requires comments and activity to be paginated.
 */

export const COMMENTS_PAGE_SIZE = 25;

export type CommentEntry = {
  id: string;
  boardId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  positionX: number | null;
  positionY: number | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type CommentPage = {
  comments: CommentEntry[];
  /** `created_at` of the oldest row returned; pass back to fetch the next page. */
  nextCursor: string | null;
};

type ProfileJoin = { display_name: string; avatar_url: string | null } | null;

type CommentRow = {
  id: string;
  board_id: string;
  author_id: string;
  body: string;
  position_x: number | null;
  position_y: number | null;
  resolved_at: string | null;
  created_at: string;
  profiles: unknown;
};

function toEntry(row: CommentRow): CommentEntry {
  const profile = row.profiles as ProfileJoin;
  return {
    id: row.id,
    boardId: row.board_id,
    authorId: row.author_id,
    authorName: profile?.display_name ?? "Unknown",
    authorAvatarUrl: profile?.avatar_url ?? null,
    body: row.body,
    positionX: row.position_x,
    positionY: row.position_y,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

export type ListCommentsOptions = {
  /** Keyset cursor: return comments older than this timestamp. */
  before?: string;
  limit?: number;
  /** Omit resolved comments. Defaults to false. */
  unresolvedOnly?: boolean;
};

export async function listComments(
  boardId: string,
  options: ListCommentsOptions = {},
): Promise<CommentPage> {
  const supabase = await createClient();
  const limit = Math.min(options.limit ?? COMMENTS_PAGE_SIZE, 100);

  let query = supabase
    .from("comments")
    .select(
      "id, board_id, author_id, body, position_x, position_y, resolved_at, created_at, profiles!inner(display_name, avatar_url)",
    )
    .eq("board_id", boardId)
    .order("created_at", { ascending: false })
    // One extra row tells us whether another page exists without a count query.
    .limit(limit + 1);

  if (options.before) query = query.lt("created_at", options.before);
  if (options.unresolvedOnly) query = query.is("resolved_at", null);

  const { data, error } = await query;
  if (error || !data) return { comments: [], nextCursor: null };

  const rows = data as unknown as CommentRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    comments: page.map(toEntry),
    nextCursor: hasMore ? (page[page.length - 1]?.created_at ?? null) : null,
  };
}

/** Unresolved comment count, for the board's comment badge. */
export async function countUnresolvedComments(boardId: string): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("board_id", boardId)
    .is("resolved_at", null);

  if (error) return 0;
  return count ?? 0;
}
