"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logActivity } from "@/lib/activity/log";
import { requireUser } from "@/lib/auth/dal";
import { clientEnv } from "@/lib/env/client";
import { fail, ok, type ActionResult } from "@/lib/forms/action-result";
import { createClient } from "@/lib/supabase/server";
import {
  boardRoleSchema,
  createInvitationSchema,
  updateWorkspaceMemberRoleSchema,
  uuidSchema,
} from "@/lib/validation/schemas";

import { createInvitation } from "./invitations";
import { disableShareLink, enableShareLink } from "./share-links";

const PERMISSION_DENIED = "You do not have permission to do that.";

function firstIssue(issues: { message: string }[]): string {
  return issues[0]?.message ?? "Please check the form and try again.";
}

/** Builds the link an inviter copies. The raw token appears only here. */
function invitationUrl(token: string): string {
  return `${clientEnv.NEXT_PUBLIC_APP_URL}/invite/${token}`;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type InvitationCreated = { url: string; email: string };

export async function createInvitationAction(
  raw: unknown,
): Promise<ActionResult<InvitationCreated>> {
  const user = await requireUser();

  const parsed = createInvitationSchema.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));

  const result = await createInvitation(parsed.data, user.id);
  if (!result.ok) return fail(result.error);

  revalidatePath("/", "layout");

  // No email is sent — there is no mail provider configured — so the inviter
  // copies this link. That is why the raw token crosses back to the client
  // exactly once and is never stored.
  return ok({ url: invitationUrl(result.data.token), email: result.data.email });
}

export async function revokeInvitationAction(raw: unknown): Promise<ActionResult<void>> {
  await requireUser();

  const parsed = z.object({ invitationId: uuidSchema }).safeParse(raw);
  if (!parsed.success) return fail("That invitation could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", parsed.data.invitationId)
    .select("id")
    .maybeSingle();

  if (error) return fail("Could not revoke the invitation. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  revalidatePath("/", "layout");
  return ok();
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export type ShareLinkCreated = { url: string };

export async function enableShareLinkAction(raw: unknown): Promise<ActionResult<ShareLinkCreated>> {
  const user = await requireUser();

  const parsed = z.object({ boardId: uuidSchema }).safeParse(raw);
  if (!parsed.success) return fail("That board could not be found.");

  const result = await enableShareLink(parsed.data.boardId);
  if ("error" in result) return fail(result.error);

  const supabase = await createClient();
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
      eventType: "board.shared",
      metadata: { enabled: true },
    });
  }

  revalidatePath("/", "layout");
  return ok({ url: `${clientEnv.NEXT_PUBLIC_APP_URL}/share/${result.token}` });
}

export async function disableShareLinkAction(raw: unknown): Promise<ActionResult<void>> {
  await requireUser();

  const parsed = z.object({ boardId: uuidSchema }).safeParse(raw);
  if (!parsed.success) return fail("That board could not be found.");

  const result = await disableShareLink(parsed.data.boardId);
  if (result.error) return fail(result.error);

  revalidatePath("/", "layout");
  return ok();
}

// ---------------------------------------------------------------------------
// Board membership
// ---------------------------------------------------------------------------

export async function setBoardMemberRoleAction(raw: unknown): Promise<ActionResult<void>> {
  await requireUser();

  const parsed = z
    .object({ boardId: uuidSchema, userId: uuidSchema, role: boardRoleSchema })
    .safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_members")
    .update({ role: parsed.data.role })
    .eq("board_id", parsed.data.boardId)
    .eq("user_id", parsed.data.userId)
    .select("board_id")
    .maybeSingle();

  if (error) return fail("Could not change that person's access. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  revalidatePath("/", "layout");
  return ok();
}

export async function removeBoardMemberAction(raw: unknown): Promise<ActionResult<void>> {
  const user = await requireUser();

  const parsed = z.object({ boardId: uuidSchema, userId: uuidSchema }).safeParse(raw);
  if (!parsed.success) return fail("That person could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_members")
    .delete()
    .eq("board_id", parsed.data.boardId)
    .eq("user_id", parsed.data.userId)
    .select("board_id")
    .maybeSingle();

  if (error) return fail("Could not remove that person. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

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
      eventType: "member.removed",
      metadata: { scope: "board" },
    });
  }

  revalidatePath("/", "layout");
  return ok();
}

// ---------------------------------------------------------------------------
// Workspace membership
// ---------------------------------------------------------------------------

export async function setWorkspaceMemberRoleAction(raw: unknown): Promise<ActionResult<void>> {
  const user = await requireUser();

  const parsed = updateWorkspaceMemberRoleSchema.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));

  const supabase = await createClient();

  // `workspace_members_update` refuses both editing an owner's row and
  // promoting anyone to owner, so ownership transfer cannot happen here.
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role: parsed.data.role })
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", parsed.data.userId)
    .select("workspace_id")
    .maybeSingle();

  if (error) return fail("Could not change that person's role. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  await logActivity(supabase, {
    workspaceId: parsed.data.workspaceId,
    actorId: user.id,
    eventType: "member.role_changed",
    metadata: { role: parsed.data.role },
  });

  revalidatePath("/", "layout");
  return ok();
}

export async function removeWorkspaceMemberAction(raw: unknown): Promise<ActionResult<void>> {
  const user = await requireUser();

  const parsed = z.object({ workspaceId: uuidSchema, userId: uuidSchema }).safeParse(raw);
  if (!parsed.success) return fail("That person could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", parsed.data.userId)
    .select("workspace_id")
    .maybeSingle();

  if (error) return fail("Could not remove that person. Please try again.");
  if (!data) return fail(PERMISSION_DENIED);

  await logActivity(supabase, {
    workspaceId: parsed.data.workspaceId,
    actorId: user.id,
    eventType: "member.removed",
    metadata: { scope: "workspace" },
  });

  revalidatePath("/", "layout");
  return ok();
}
