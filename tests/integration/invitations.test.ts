// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, expectDenied, type TestDb } from "../helpers/database";

/**
 * `accept_invitation` is SECURITY DEFINER: it creates a membership the caller
 * has no permission to create, which is the entire point of being invited. It
 * therefore performs its own authorization, and these tests are that
 * authorization's only safety net.
 */

let t: TestDb;
let inviter: string;
let invitee: string;
let stranger: string;
let workspaceId: string;
let boardId: string;

/** Token hashes are opaque to the database; any 64-char hex works in tests. */
function hash(seed: string): string {
  return seed
    .padEnd(64, "0")
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, "a");
}

async function createInvite(options: {
  tokenHash: string;
  email: string;
  role: string;
  boardId?: string | null;
  expiresInDays?: number;
}) {
  await t.asAdmin();
  // invitations_unique_pending_idx allows only one outstanding invitation per
  // (target, email). Clearing first mirrors a real re-invite, which revokes
  // the previous one.
  await t.db.query(
    `delete from public.invitations
     where workspace_id = $1
       and coalesce(board_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       and email = $3
       and accepted_at is null`,
    [workspaceId, options.boardId ?? null, options.email],
  );
  await t.db.query(
    `insert into public.invitations (workspace_id, board_id, email, role, token_hash, invited_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval)`,
    [
      workspaceId,
      options.boardId ?? null,
      options.email,
      options.role,
      options.tokenHash,
      inviter,
      String(options.expiresInDays ?? 7),
    ],
  );
}

type AcceptResult = { workspaceId: string; boardId: string | null; target: string };

async function accept(tokenHash: string) {
  const result = await t.db.query<{ accept_invitation: AcceptResult }>(
    `select public.accept_invitation($1) as accept_invitation`,
    [tokenHash],
  );
  return result.rows[0]!.accept_invitation;
}

beforeAll(async () => {
  t = await createTestDb();

  inviter = await t.createUser("inviter@example.com", "Inviter");
  invitee = await t.createUser("invitee@example.com", "Invitee");
  stranger = await t.createUser("stranger@example.com", "Stranger");

  await t.asAdmin();
  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Invites', 'invites', $1) returning id`,
    [inviter],
  );
  workspaceId = ws.rows[0]!.id;

  const board = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Private plans', $2, 'private') returning id`,
    [workspaceId, inviter],
  );
  boardId = board.rows[0]!.id;
});

afterAll(async () => {
  await t?.close();
});

describe("accepting a workspace invitation", () => {
  it("creates the membership and consumes the invitation", async () => {
    const token = hash("aa1");
    await createInvite({ tokenHash: token, email: "invitee@example.com", role: "member" });

    await t.asUser(invitee);
    const result = await accept(token);

    expect(result.target).toBe("workspace");
    expect(result.workspaceId).toBe(workspaceId);

    await t.asAdmin();
    const membership = await t.db.query<{ role: string }>(
      `select role from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [workspaceId, invitee],
    );
    expect(membership.rows[0]!.role).toBe("member");

    const invite = await t.db.query<{ accepted_at: string | null }>(
      `select accepted_at from public.invitations where token_hash = $1`,
      [token],
    );
    expect(invite.rows[0]!.accepted_at).not.toBeNull();
  });

  it("cannot be used twice", async () => {
    // Single use is what stops a forwarded link becoming an open door.
    const token = hash("bb2");
    await createInvite({ tokenHash: token, email: "invitee@example.com", role: "member" });

    await t.asUser(invitee);
    await accept(token);

    const message = await expectDenied(() => accept(token));
    expect(message).toMatch(/invalid or has expired/i);
  });
});

describe("accepting a board invitation", () => {
  it("grants access to a private board without workspace membership", async () => {
    const token = hash("cc3");
    await createInvite({
      tokenHash: token,
      email: "stranger@example.com",
      role: "viewer",
      boardId,
    });

    await t.asUser(stranger);
    const result = await accept(token);
    expect(result.target).toBe("board");

    // The whole point: a board invitation works for someone outside the workspace.
    const visible = await t.db.query(`select id from public.boards where id = $1`, [boardId]);
    expect(visible.rows).toHaveLength(1);

    const role = await t.db.query<{ role: string }>(`select public.board_access_role($1) as role`, [
      boardId,
    ]);
    expect(role.rows[0]!.role).toBe("viewer");
  });
});

describe("authorization", () => {
  it("refuses a user whose email does not match", async () => {
    // An invitation is addressed to a person, not to whoever holds the link.
    const token = hash("dd4");
    await createInvite({ tokenHash: token, email: "invitee@example.com", role: "member" });

    await t.asUser(stranger);
    const message = await expectDenied(() => accept(token));
    expect(message).toMatch(/different email address/i);

    await t.asAdmin();
    const leaked = await t.db.query(
      `select 1 from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [workspaceId, stranger],
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it("refuses an unauthenticated caller", async () => {
    const token = hash("ee5");
    await createInvite({ tokenHash: token, email: "invitee@example.com", role: "member" });

    await t.asAnon();
    const message = await expectDenied(() => accept(token));
    // anon has no EXECUTE grant, so it fails before the function body runs.
    expect(message).toMatch(/permission denied|not authenticated/i);
  });

  it("refuses an expired invitation", async () => {
    await t.asAdmin();
    const token = hash("ff6");

    // `invitations_expires_after_creation` forbids backdating expires_at on an
    // existing row, so the whole invitation is inserted already aged: created
    // 30 days ago, expired an hour ago.
    await t.db.query(
      `delete from public.invitations
       where workspace_id = $1 and board_id is null and email = $2 and accepted_at is null`,
      [workspaceId, "invitee@example.com"],
    );
    await t.db.query(
      `insert into public.invitations
         (workspace_id, board_id, email, role, token_hash, invited_by, created_at, expires_at)
       values ($1, null, $2, 'member', $3, $4, now() - interval '30 days', now() - interval '1 hour')`,
      [workspaceId, "invitee@example.com", token, inviter],
    );

    await t.asUser(invitee);
    const message = await expectDenied(() => accept(token));
    expect(message).toMatch(/invalid or has expired/i);
  });

  it("refuses an unknown token with the same message as an expired one", async () => {
    // Uniform failure: a bad token cannot be probed for why it failed.
    await t.asUser(invitee);
    const message = await expectDenied(() => accept(hash("999")));
    expect(message).toMatch(/invalid or has expired/i);
  });
});

describe("privilege safety", () => {
  it("never downgrades an existing role", async () => {
    // A stale 'member' invitation accepted by the workspace owner must not
    // demote them.
    const token = hash("aa7");
    await createInvite({ tokenHash: token, email: "inviter@example.com", role: "member" });

    await t.asUser(inviter);
    await accept(token);

    await t.asAdmin();
    const role = await t.db.query<{ role: string }>(
      `select role from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [workspaceId, inviter],
    );
    expect(role.rows[0]!.role).toBe("owner");
  });

  it("records the join in the activity log", async () => {
    await t.asAdmin();
    const events = await t.db.query<{ event_type: string; actor_id: string }>(
      `select event_type, actor_id from public.activity_logs
       where workspace_id = $1 and event_type = 'member.joined' and actor_id = $2`,
      [workspaceId, invitee],
    );
    expect(events.rows.length).toBeGreaterThan(0);
  });
});
