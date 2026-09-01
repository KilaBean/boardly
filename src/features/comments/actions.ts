"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logActivity } from "@/lib/activity/log";
import { requireUser } from "@/lib/auth/dal";
import { fail, ok, type ActionResult } from "@/lib/forms/action-result";
import { createClient } from "@/lib/supabase/server";
import { createCommentSchema, resolveCommentSchema, uuidSchema } from "@/lib/validation/schemas";

/**
 * Comment mutations.
 *
 * As everywhere else, permission is decided by the row count: RLS filters out
 * rows the user may not touch, so `.select().maybeSingle()` returning null
 * *is* the denial. Two rules are worth restating because they are enforced
 * below the application:
 *
 *   - Viewers may comment. A comment is discussion *about* the board, not
 *     content *on* it, so `comments_insert` requires only `can_view_board`.
 *   - Only the author may change a comment's body. Column grants cannot
 *     express "author may edit body, editor may only resolve", so the
 *     `comments_enforce_body_author` trigger closes that gap.
 */

const PERMISSION_DENIED = "You do not have permission to do that.";

function firstIssue(issues: { message: string }[]): string {
  return issues[0]?.message ?? "Please check the form and try again.";
}

export type CreatedComment = { id: string };

export async function createCommentAction(raw: unknown): Promise<ActionResult<CreatedComment>> {
  const user = await requireUser();

  const parsed = createCommentSchema.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .insert({
      board_id: parsed.data.boardId,
      author_id: user.id,
      body: parsed.data.body,
      position_x: parsed.data.positionX,
      position_y: parsed.data.positionY,
    })
    .select("id, board_id")
    .maybeSingle();

  if (error || !data) return fail("You do not have access to comment on this board.");

  const { data: board } = await supabase
    .from("boards")
    .select("workspace_id")
    .eq("id", parsed.data.boardId)
    .maybeSingle();

  if (board) {
    await logActivity(supabase, {
      workspaceId: board.workspace_id,
      boardId: parsed.data.boardId,
      actorId: user.id,
      eventType: "comment.created",
      // The comment body is user content and is readable by anyone who can see
      // the board anyway — but the activity feed is a different surface, so
      // only the fact is recorded, never the text.
      metadata: { anchored: parsed.data.positionX !== null },
    });
  }

  revalidatePath("/", "layout");
  return ok({ id: data.id });
}

export async function resolveCommentAction(raw: unknown): Promise<ActionResult<void>> {
  const user = await requireUser();

  const parsed = resolveCommentSchema.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ resolved_at: parsed.data.resolved ? new Date().toISOString() : null })
    .eq("id", parsed.data.commentId)
    .select("id, board_id")
    .maybeSingle();

  if (error) return fail("Could not update the comment. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  if (parsed.data.resolved) {
    const { data: board } = await supabase
      .from("boards")
      .select("workspace_id")
      .eq("id", data.board_id)
      .maybeSingle();

    if (board) {
      await logActivity(supabase, {
        workspaceId: board.workspace_id,
        boardId: data.board_id,
        actorId: user.id,
        eventType: "comment.resolved",
      });
    }
  }

  revalidatePath("/", "layout");
  return ok();
}

/**
 * Edits a comment's body.
 *
 * The database trigger rejects this for anyone but the author, and surfaces
 * `insufficient_privilege`. Translated here into a message rather than shown
 * raw, but the enforcement is not in this function.
 */
export async function updateCommentAction(raw: unknown): Promise<ActionResult<void>> {
  await requireUser();

  const parsed = z
    .object({ commentId: uuidSchema, body: z.string().trim().min(1).max(4000) })
    .safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.commentId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.message.toLowerCase().includes("comment author")) {
      return fail("Only the author can edit a comment.");
    }
    return fail("Could not update the comment. Please try again.");
  }
  if (!data) return fail(PERMISSION_DENIED);

  revalidatePath("/", "layout");
  return ok();
}

export async function deleteCommentAction(raw: unknown): Promise<ActionResult<void>> {
  await requireUser();

  const parsed = z.object({ commentId: uuidSchema }).safeParse(raw);
  if (!parsed.success) return fail("That comment could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .delete()
    .eq("id", parsed.data.commentId)
    .select("id")
    .maybeSingle();

  if (error) return fail("Could not delete the comment. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  revalidatePath("/", "layout");
  return ok();
}
