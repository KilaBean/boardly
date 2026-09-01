import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { requireEnv } from "./env";

/**
 * Test data seeding against a real Supabase instance.
 *
 * Uses the service role, which bypasses RLS — appropriate here because the
 * point is to *arrange* state that the tests then exercise through the UI as
 * an ordinary user. Nothing in these helpers asserts permissions; the tests do
 * that by driving the browser.
 *
 * Intended for a local `supabase start` stack. Pointing it at a shared project
 * would create real users, so the URL is checked below.
 */

export function adminClient(): SupabaseClient<Database> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Guardrail: this creates and deletes users. Running it against a hosted
  // project by accident would be destructive, so it refuses anything that is
  // not obviously local unless explicitly overridden.
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?$/.test(url);
  if (!isLocal && process.env.ALLOW_REMOTE_E2E_SEED !== "1") {
    throw new Error(
      `Refusing to seed test data against a non-local Supabase (${url}). ` +
        `Set ALLOW_REMOTE_E2E_SEED=1 only if you are certain this is a disposable project.`,
    );
  }

  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type SeededUser = {
  id: string;
  email: string;
  password: string;
  displayName: string;
};

/**
 * Creates a confirmed user.
 *
 * `email_confirm: true` skips the confirmation email — there is no mail
 * provider in a local stack, and the confirmation flow is a Supabase concern
 * rather than something these tests are verifying.
 *
 * Idempotent: an existing user with the same address is deleted first, so a
 * re-run starts from a known state instead of failing on a duplicate.
 */
export async function createConfirmedUser(
  email: string,
  password: string,
  displayName: string,
): Promise<SeededUser> {
  const admin = adminClient();

  await deleteUserByEmail(email);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName },
  });

  if (error || !data.user) {
    throw new Error(`Could not create ${email}: ${error?.message ?? "no user returned"}`);
  }

  return { id: data.user.id, email, password, displayName };
}

/** Removes a user and, by cascade, their profile. */
export async function deleteUserByEmail(email: string): Promise<void> {
  const admin = adminClient();

  // listUsers is paginated; test addresses are distinctive so one page is ample.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = data?.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (!existing) return;

  // Workspaces use ON DELETE RESTRICT on owner_id, so anything they own has to
  // go first — the same constraint that protects real teams from losing data
  // when a member is removed.
  await admin.from("workspaces").delete().eq("owner_id", existing.id);
  await admin.auth.admin.deleteUser(existing.id);
}

export type SeededWorkspace = { id: string; slug: string; name: string };

export async function createWorkspace(
  ownerId: string,
  name: string,
  slug: string,
): Promise<SeededWorkspace> {
  const admin = adminClient();

  const { data, error } = await admin
    .from("workspaces")
    .insert({ name, slug, owner_id: ownerId })
    .select("id, slug, name")
    .single();

  if (error || !data) {
    throw new Error(`Could not create workspace ${slug}: ${error?.message}`);
  }
  return data;
}

export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: "admin" | "member",
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role });

  if (error) throw new Error(`Could not add member: ${error.message}`);
}

export type SeededBoard = { id: string; name: string };

export async function createBoard(
  workspaceId: string,
  ownerId: string,
  name: string,
  visibility: "private" | "workspace" = "workspace",
): Promise<SeededBoard> {
  const admin = adminClient();

  const { data, error } = await admin
    .from("boards")
    .insert({ workspace_id: workspaceId, owner_id: ownerId, name, visibility })
    .select("id, name")
    .single();

  if (error || !data) throw new Error(`Could not create board ${name}: ${error?.message}`);
  return data;
}

export async function addBoardMember(
  boardId: string,
  userId: string,
  role: "editor" | "viewer",
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("board_members")
    .insert({ board_id: boardId, user_id: userId, role });

  if (error) throw new Error(`Could not add board member: ${error.message}`);
}
