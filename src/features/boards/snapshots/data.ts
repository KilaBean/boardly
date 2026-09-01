import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export type BoardSnapshot = {
  version: number;
  document: Json;
};

/**
 * The most recent snapshot for a board, or null if it has never been saved.
 *
 * Read through the user's client, so `board_snapshots_select` (which requires
 * `can_view_board`) decides whether anything comes back. A user without access
 * gets null, indistinguishable from an empty board.
 */
export async function getLatestSnapshot(boardId: string): Promise<BoardSnapshot | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("board_snapshots")
    .select("version, snapshot")
    .eq("board_id", boardId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return { version: data.version, document: data.snapshot };
}
