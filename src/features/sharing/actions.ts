"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logActivity } from "@/lib/activity/log";
import { getCurrentUser, requireUser } from "@/lib/auth/dal";
import { clientEnv } from "@/lib/env/client";
import { INVITATION_TTL_DAYS } from "@/lib/invitations/token";
import { sendEmail } from "@/lib/mail";
import { fail, ok, type ActionResult } from "@/lib/forms/action-result";
import { createClient } from "@/lib/supabase/server";
import {
  boardRoleSchema,
  createInvitationSchema,
  updateWorkspaceMemberRoleSchema,
  uuidSchema,
  type CreateInvitationInput,
} from "@/lib/validation/schemas";

import { buildInvitationEmail } from "./invitation-email";
import { createInvitation } from "./invitations";
import { disableShareLink, enableShareLink, redeemShareLink } from "./share-links";

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

export type InvitationCreated = { url: string; email: string; delivered: boolean };

export async function createInvitationAction(
  raw: unknown,
): Promise<ActionResult<InvitationCreated>> {
  const user = await requireUser();

  const parsed = createInvitationSchema.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));

  const result = await createInvitation(parsed.data, user.id);
  if (!result.ok) return fail(result.error);

  revalidatePath("/", "layout");

  const url = invitationUrl(result.data.token);

  // The raw token crosses back to the client exactly once and is never stored,
  // because the copyable link stays the fallback whenever mail is unconfigured
  // or the send fails.
  const { delivered } = await sendInvitationEmail({
    to: result.data.email,
    url,
    input: parsed.data,
  });

  return ok({ url, email: result.data.email, delivered });
}

/**
 * Sends the invitation, best-effort.
 *
 * Deliberately after the row is committed and never allowed to fail the
 * action: the invitation is the durable thing, and an undelivered one is
 * recoverable by copying the link. Failing the whole invite because a mail
 * provider was slow would destroy work to report a delivery problem.
 */
async function sendInvitationEmail({
  to,
  url,
  input,
}: {
  to: string;
  url: string;
  input: CreateInvitationInput;
}): Promise<{ delivered: boolean }> {
  // `getCurrentUser` is request-cached, so this costs nothing extra here.
  const inviter = await getCurrentUser();
  const inviterName = inviter?.displayName ?? "Someone";

  // Names are read back from the database rather than taken from the client:
  // they go into an email sent to someone else, so they must not be
  // attacker-controlled text passed through the form.
  const supabase = await createClient();

  const { data } =
    input.target === "board"
      ? await supabase.from("boards").select("name").eq("id", input.boardId).maybeSingle()
      : await supabase.from("workspaces").select("name").eq("id", input.workspaceId).maybeSingle();

  const email = buildInvitationEmail({
    to,
    inviterName,
    targetName: data?.name ?? null,
    target: input.target,
    role: input.role,
    url,
    expiresInDays: INVITATION_TTL_DAYS,
  });

  const result = await sendEmail(email);
  return { delivered: result.delivered };
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

  const parsed = z.object({ boardId: uuidSchema, role: boardRoleSchema }).safeParse(raw);
  if (!parsed.success) return fail("That board could not be found.");

  const result = await enableShareLink(parsed.data.boardId, parsed.data.role);
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
      metadata: { enabled: true, role: parsed.data.role },
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

/**
 * Redeems an edit share link for the signed-in user.
 *
 * A separate action rather than something the share page does while rendering:
 * it changes membership, so it must be a deliberate POST the visitor triggers,
 * not a side effect of following a link.
 */
export async function redeemShareLinkAction(
  raw: unknown,
): Promise<ActionResult<{ boardId: string }>> {
  await requireUser();

  const parsed = z.object({ token: z.string().min(20).max(200) }).safeParse(raw);
  if (!parsed.success) return fail("That link is not valid.");

  const result = await redeemShareLink(parsed.data.token);
  if ("error" in result) return fail(result.error);

  revalidatePath("/", "layout");
  return ok({ boardId: result.boardId });
}
