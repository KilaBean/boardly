import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateToken, hashToken, isPlausibleToken } from "@/lib/tokens/secure-token";
import type { Json } from "@/types/database";

/**
 * Share links.
 *
 * `boards.share_token_hash` carries no SELECT or UPDATE grant for
 * `authenticated`, so every operation here needs the service role. That is
 * deliberate — it forces the authorization check to be explicit and visible
 * rather than delegated to a policy that does not cover the column.
 *
 * The pattern is always the same, and the order matters:
 *   1. Ask the *user's* client whether they own the board (RLS applies).
 *   2. Only then use the admin client, scoped to that one board id.
 */

export type ShareLinkRole = "editor" | "viewer";

export type ShareLinkResult = { token: string } | { error: string };

/** Confirms ownership using the caller's own permissions, never the admin client. */
async function assertBoardOwner(boardId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_board_owner", { p_board_id: boardId });
  return !error && data === true;
}

/**
 * Turns link sharing on, or rotates an existing link.
 *
 * Rotation is the revocation mechanism: replacing the hash invalidates every
 * previously shared URL immediately.
 */
export async function enableShareLink(
  boardId: string,
  role: ShareLinkRole,
): Promise<ShareLinkResult> {
  if (!(await assertBoardOwner(boardId))) {
    return { error: "Only the board owner can change sharing." };
  }

  const { token, tokenHash } = generateToken();

  const admin = createAdminClient();

  // Upsert rather than insert: rotating an existing link replaces its hash,
  // which is how revocation works. The trigger on this table keeps
  // boards.share_link_enabled in step.
  const { error } = await admin
    .from("board_share_links")
    .upsert({ board_id: boardId, token_hash: tokenHash, role }, { onConflict: "board_id" });

  if (error) return { error: "Could not create a share link. Please try again." };
  return { token };
}

/** Turns link sharing off and destroys the token, killing existing URLs. */
export async function disableShareLink(boardId: string): Promise<{ error?: string }> {
  if (!(await assertBoardOwner(boardId))) {
    return { error: "Only the board owner can change sharing." };
  }

  const admin = createAdminClient();

  // Deleting the row is a true revocation, not a switch that could be flipped
  // back on to revive old links. The trigger clears the board's flag.
  const { error } = await admin.from("board_share_links").delete().eq("board_id", boardId);

  if (error) return { error: "Could not disable the share link. Please try again." };
  return {};
}

export type SharedBoard = {
  id: string;
  name: string;
  document: Json | null;
  /** What the link grants. "editor" is redeemed by a signed-in user. */
  role: ShareLinkRole;
};

/**
 * Resolves a share token to a read-only board.
 *
 * Runs for unauthenticated visitors, so it uses the admin client — but it is
 * narrowly scoped: an exact match on the token hash, and only when sharing is
 * still enabled and the board is not archived. It returns just the name and
 * the document, never workspace, owner or membership information.
 */
export async function resolveShareToken(token: unknown): Promise<SharedBoard | null> {
  // Reject anything that is not token-shaped before it reaches the database.
  if (!isPlausibleToken(token)) return null;

  const admin = createAdminClient();

  // Resolve the token to a board id first, then load the board. Two narrow
  // lookups rather than one embedded query, so neither depends on PostgREST
  // join behaviour across a table `authenticated` cannot see.
  const { data: link } = await admin
    .from("board_share_links")
    .select("board_id, role")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!link) return null;

  const { data: board, error } = await admin
    .from("boards")
    .select("id, name")
    .eq("id", link.board_id)
    .eq("share_link_enabled", true)
    .is("archived_at", null)
    .maybeSingle();

  if (error || !board) return null;

  const { data: snapshot } = await admin
    .from("board_snapshots")
    .select("snapshot")
    .eq("board_id", board.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    id: board.id,
    name: board.name,
    document: snapshot?.snapshot ?? null,
    role: link.role as ShareLinkRole,
  };
}

/**
 * Turns an edit link into board membership for the signed-in caller.
 *
 * Runs through the user's own client so `auth.uid()` inside the function is
 * the person redeeming it — the admin client would make every redemption
 * anonymous, which is the whole thing this design avoids.
 *
 * The token is hashed here; the raw value never reaches the database.
 */
export async function redeemShareLink(
  token: unknown,
): Promise<{ boardId: string } | { error: string }> {
  if (!isPlausibleToken(token)) return { error: "That link is not valid." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_share_link", {
    p_token_hash: hashToken(token),
  });

  if (error || !data) {
    // The function raises one message for every failure mode, so nothing here
    // can be used to probe which links exist.
    return { error: "That link cannot be used to edit this board." };
  }

  const boardId = (data as { boardId?: string }).boardId;
  if (!boardId) return { error: "That link cannot be used to edit this board." };

  return { boardId };
}
