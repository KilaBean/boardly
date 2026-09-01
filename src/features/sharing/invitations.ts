import "server-only";

import { logActivity } from "@/lib/activity/log";
import { generateInvitationToken, hashInvitationToken } from "@/lib/invitations/token";
import { createClient } from "@/lib/supabase/server";
import { isPlausibleToken } from "@/lib/tokens/secure-token";
import type { CreateInvitationInput } from "@/lib/validation/schemas";

/**
 * Invitations.
 *
 * Creating one needs no explicit permission check: `invitations_insert`
 * requires workspace-admin or board-owner and `invited_by = auth.uid()`, so an
 * unauthorized insert simply matches no policy and fails.
 *
 * Accepting one is the opposite — the invitee has no permission to create
 * their own membership — so it goes through the `accept_invitation` SQL
 * function, which is atomic and does its own authorization.
 */

export type CreatedInvitation = { token: string; email: string };

export async function createInvitation(
  input: CreateInvitationInput,
  actorId: string,
): Promise<{ ok: true; data: CreatedInvitation } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { token, tokenHash, expiresAt } = generateInvitationToken();

  const boardId = input.target === "board" ? input.boardId : null;

  const { error } = await supabase.from("invitations").insert({
    workspace_id: input.workspaceId,
    board_id: boardId,
    email: input.email,
    role: input.role,
    token_hash: tokenHash,
    invited_by: actorId,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    // A pending invitation for the same (target, email) already exists.
    if (error.code === "23505") {
      return { ok: false, error: "There is already a pending invitation for that address." };
    }
    return { ok: false, error: "You do not have permission to invite people here." };
  }

  await logActivity(supabase, {
    workspaceId: input.workspaceId,
    boardId,
    actorId,
    eventType: "member.invited",
    // Deliberately records the role but not the email: activity is visible to
    // every workspace member, and who was invited where is not their business
    // until the person actually joins.
    metadata: { role: input.role, target: input.target },
  });

  return { ok: true, data: { token, email: input.email } };
}

export type AcceptedInvitation = {
  workspaceId: string;
  boardId: string | null;
  target: string;
};

export async function acceptInvitation(
  token: unknown,
): Promise<{ ok: true; data: AcceptedInvitation } | { ok: false; error: string }> {
  if (!isPlausibleToken(token)) {
    return { ok: false, error: "That invitation link is not valid." };
  }

  const supabase = await createClient();

  // The function is atomic and enforces expiry, single use, and that the
  // signed-in user's email matches the address the invitation was sent to.
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token_hash: hashInvitationToken(token),
  });

  if (error) {
    // Surface the email mismatch, because it is actionable — the user needs to
    // know to sign in with a different account. Everything else collapses to
    // one message so a bad token cannot be probed.
    if (error.message.includes("different email address")) {
      return {
        ok: false,
        error: "This invitation was sent to a different email address. Sign in with that account.",
      };
    }
    return { ok: false, error: "This invitation is invalid or has expired." };
  }

  if (!data) {
    return { ok: false, error: "This invitation is invalid or has expired." };
  }

  return {
    ok: true,
    data: { workspaceId: data.workspaceId, boardId: data.boardId, target: data.target },
  };
}
