"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logActivity } from "@/lib/activity/log";
import { requireUser } from "@/lib/auth/dal";
import { fail, ok, type ActionResult } from "@/lib/forms/action-result";
import { createClient } from "@/lib/supabase/server";
import { createBoardSchema, updateBoardSchema, uuidSchema } from "@/lib/validation/schemas";

/**
 * Board mutations.
 *
 * None of these check permissions in application code. RLS decides, and the
 * signal is the row count: an `update` the user is not allowed to make
 * matches zero rows and returns no data. That is why every mutation below
 * uses `.select().maybeSingle()` and treats a null result as "not permitted"
 * — the check cannot be forgotten, because it is the same code path that
 * fetches the result.
 */

const PERMISSION_DENIED = "You do not have permission to do that.";

const boardIdSchema = z.object({ boardId: uuidSchema });

export type CreatedBoard = { id: string };

export async function createBoardAction(raw: unknown): Promise<ActionResult<CreatedBoard>> {
  const user = await requireUser();

  const parsed = createBoardSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .insert({
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      owner_id: user.id,
      visibility: parsed.data.visibility,
    })
    .select("id")
    .maybeSingle();

  // boards_insert requires workspace membership; a non-member gets rejected
  // here rather than by an application-level check.
  if (error || !data) {
    return fail("Could not create the board. You may not be a member of this workspace.");
  }

  await logActivity(supabase, {
    workspaceId: parsed.data.workspaceId,
    boardId: data.id,
    actorId: user.id,
    eventType: "board.created",
    metadata: { name: parsed.data.name, visibility: parsed.data.visibility },
  });

  revalidatePath("/", "layout");
  return ok({ id: data.id });
}

export async function updateBoardAction(raw: unknown): Promise<ActionResult<void>> {
  const user = await requireUser();

  const parsed = updateBoardSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }

  const { boardId, name, visibility } = parsed.data;
  if (name === undefined && visibility === undefined) {
    return ok();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    // share_link_enabled is deliberately absent: it is maintained by the
    // trigger on board_share_links, so a board cannot claim to be shared
    // without a link actually existing.
    .update({
      ...(name !== undefined ? { name } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
    })
    .eq("id", boardId)
    .select("id, workspace_id, name")
    .maybeSingle();

  if (error) return fail("Could not update the board. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  if (name !== undefined) {
    await logActivity(supabase, {
      workspaceId: data.workspace_id,
      boardId,
      actorId: user.id,
      eventType: "board.renamed",
      metadata: { name },
    });
  }
  if (visibility !== undefined) {
    await logActivity(supabase, {
      workspaceId: data.workspace_id,
      boardId,
      actorId: user.id,
      eventType: "board.visibility_changed",
      metadata: { visibility },
    });
  }

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Archive and restore.
 *
 * Archiving is reversible and is the default "delete" in the UI. Note that
 * `can_edit_board()` returns false for an archived board, so its contents
 * freeze — but `boards_update` is governed by `is_board_owner`, which is what
 * lets the owner bring it back.
 */
export async function setBoardArchivedAction(
  raw: unknown,
  archived: boolean,
): Promise<ActionResult<void>> {
  const user = await requireUser();

  const parsed = boardIdSchema.safeParse(raw);
  if (!parsed.success) return fail("That board could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", parsed.data.boardId)
    .select("id, workspace_id, name")
    .maybeSingle();

  if (error) return fail("Could not update the board. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  await logActivity(supabase, {
    workspaceId: data.workspace_id,
    boardId: data.id,
    actorId: user.id,
    eventType: archived ? "board.archived" : "board.restored",
    metadata: { name: data.name },
  });

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Permanent deletion.
 *
 * Cascades to comments, snapshots, board members and activity rows for this
 * board. The UI must confirm before calling this; archiving is the reversible
 * option and should be the default affordance.
 */
export async function deleteBoardAction(raw: unknown): Promise<ActionResult<void>> {
  await requireUser();

  const parsed = boardIdSchema.safeParse(raw);
  if (!parsed.success) return fail("That board could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .delete()
    .eq("id", parsed.data.boardId)
    .select("id")
    .maybeSingle();

  if (error) return fail("Could not delete the board. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  revalidatePath("/", "layout");
  return ok();
}
