import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ActivityEventType, Json } from "@/types/database";

/**
 * Activity feed reads.
 *
 * `activity_logs_select` already restricts rows to workspaces the user belongs
 * to, and further to boards they can view — so a private board's activity does
 * not leak into a colleague's feed. No membership filtering is repeated here.
 *
 * Keyset pagination, like comments: a feed grows while you read it, and
 * `offset` would skip or duplicate rows.
 */

export const ACTIVITY_PAGE_SIZE = 20;

export type ActivityEntry = {
  id: string;
  eventType: ActivityEventType;
  actorId: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  boardId: string | null;
  metadata: Json;
  createdAt: string;
};

export type ActivityPage = {
  entries: ActivityEntry[];
  nextCursor: string | null;
};

type ActivityRow = {
  id: string;
  event_type: ActivityEventType;
  actor_id: string | null;
  board_id: string | null;
  metadata: Json;
  created_at: string;
  profiles: unknown;
};

export type ListActivityOptions = {
  before?: string;
  limit?: number;
  /** Restrict to one board's activity. */
  boardId?: string;
};

export async function listActivity(
  workspaceId: string,
  options: ListActivityOptions = {},
): Promise<ActivityPage> {
  const supabase = await createClient();
  const limit = Math.min(options.limit ?? ACTIVITY_PAGE_SIZE, 100);

  let query = supabase
    .from("activity_logs")
    // Left join, not inner: actor_id is ON DELETE SET NULL so the trail
    // outlives the account. An inner join would silently drop that history.
    .select(
      "id, event_type, actor_id, board_id, metadata, created_at, profiles(display_name, avatar_url)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options.before) query = query.lt("created_at", options.before);
  if (options.boardId) query = query.eq("board_id", options.boardId);

  const { data, error } = await query;
  if (error || !data) return { entries: [], nextCursor: null };

  const rows = data as unknown as ActivityRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    entries: page.map((row) => {
      const profile = row.profiles as { display_name: string; avatar_url: string | null } | null;
      return {
        id: row.id,
        eventType: row.event_type,
        actorId: row.actor_id,
        actorName: profile?.display_name ?? null,
        actorAvatarUrl: profile?.avatar_url ?? null,
        boardId: row.board_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      };
    }),
    nextCursor: hasMore ? (page[page.length - 1]?.created_at ?? null) : null,
  };
}
