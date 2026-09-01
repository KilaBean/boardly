// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, expectDenied, type TestDb } from "../helpers/database";

/**
 * These tests run the real migration files against a real Postgres (PGlite).
 * They exist because RLS is the only thing standing between one customer's
 * boards and another's — reviewing the SQL by eye is not evidence that it
 * denies what it should.
 */

let t: TestDb;

// Workspace 1 (Acme): alice owns, carol admins, bob is a plain member.
let alice: string;
let bob: string;
let carol: string;
// Workspace 2 (Rival): mallory owns. Should never see anything from Acme.
let mallory: string;

let acme: string;
let rival: string;

let sharedBoard: string; // visibility = workspace
let privateBoard: string; // visibility = private, owned by alice
let archivedBoard: string;

beforeAll(async () => {
  t = await createTestDb();

  alice = await t.createUser("alice@example.com", "Alice");
  bob = await t.createUser("bob@example.com", "Bob");
  carol = await t.createUser("carol@example.com", "Carol");
  mallory = await t.createUser("mallory@example.com", "Mallory");

  await t.asAdmin();

  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Acme', 'acme', $1) returning id`,
    [alice],
  );
  acme = ws.rows[0]!.id;

  const ws2 = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Rival', 'rival', $1) returning id`,
    [mallory],
  );
  rival = ws2.rows[0]!.id;

  await t.db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'admin')`,
    [acme, bob, carol],
  );

  const b1 = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Roadmap', $2, 'workspace') returning id`,
    [acme, alice],
  );
  sharedBoard = b1.rows[0]!.id;

  const b2 = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Secret Plans', $2, 'private') returning id`,
    [acme, alice],
  );
  privateBoard = b2.rows[0]!.id;

  const b3 = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility, archived_at)
     values ($1, 'Old Board', $2, 'workspace', now()) returning id`,
    [acme, alice],
  );
  archivedBoard = b3.rows[0]!.id;
});

afterAll(async () => {
  await t?.close();
});

describe("workspace tenancy isolation", () => {
  it("hides a workspace from a user who is not a member", async () => {
    await t.asUser(mallory);
    const result = await t.db.query(`select id from public.workspaces where id = $1`, [acme]);
    expect(result.rows).toHaveLength(0);
  });

  it("shows a workspace to its members", async () => {
    await t.asUser(bob);
    const result = await t.db.query(`select id from public.workspaces where id = $1`, [acme]);
    expect(result.rows).toHaveLength(1);
  });

  it("shows each user exactly their own workspaces and no others", async () => {
    // Positive control: proves the policy discriminates rather than simply
    // denying everything, which would make the isolation tests vacuous.
    await t.asUser(mallory);
    const visible = await t.db.query<{ id: string }>(`select id from public.workspaces`);
    expect(visible.rows.map((r) => r.id)).toEqual([rival]);
  });

  it("hides every board of a foreign workspace", async () => {
    await t.asUser(mallory);
    const result = await t.db.query(`select id from public.boards where workspace_id = $1`, [acme]);
    expect(result.rows).toHaveLength(0);
  });

  it("refuses to create a board inside a workspace the user does not belong to", async () => {
    await t.asUser(mallory);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.boards (workspace_id, name, owner_id) values ($1, 'Intrusion', $2)`,
        [acme, mallory],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("refuses to create a board owned by somebody else", async () => {
    await t.asUser(bob);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.boards (workspace_id, name, owner_id) values ($1, 'Impersonated', $2)`,
        [acme, alice],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });
});

describe("board visibility", () => {
  it("lets a workspace member see a workspace-visible board", async () => {
    await t.asUser(bob);
    const result = await t.db.query(`select id from public.boards where id = $1`, [sharedBoard]);
    expect(result.rows).toHaveLength(1);
  });

  it("hides a private board from a workspace member who was not granted access", async () => {
    await t.asUser(bob);
    const result = await t.db.query(`select id from public.boards where id = $1`, [privateBoard]);
    expect(result.rows).toHaveLength(0);
  });

  it("hides a private board even from a workspace admin", async () => {
    // Deliberate least-privilege choice: workspace administration does not
    // confer content access. See docs/adr/0002-authorization-model.md.
    await t.asUser(carol);
    const result = await t.db.query(`select id from public.boards where id = $1`, [privateBoard]);
    expect(result.rows).toHaveLength(0);
  });

  it("grants access to a private board once an explicit board member row exists", async () => {
    await t.asAdmin();
    await t.db.query(
      `insert into public.board_members (board_id, user_id, role) values ($1, $2, 'viewer')`,
      [privateBoard, bob],
    );

    await t.asUser(bob);
    const result = await t.db.query(`select id from public.boards where id = $1`, [privateBoard]);
    expect(result.rows).toHaveLength(1);
  });
});

describe("editor and viewer enforcement", () => {
  it("lets a workspace member write a snapshot to a workspace-visible board", async () => {
    await t.asUser(bob);
    await t.db.query(
      `insert into public.board_snapshots (board_id, version, snapshot) values ($1, 1, '{}'::jsonb)`,
      [sharedBoard],
    );
    const result = await t.db.query(`select id from public.board_snapshots where board_id = $1`, [
      sharedBoard,
    ]);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("blocks snapshot writes from a viewer whose explicit role overrides the workspace default", async () => {
    // Carol is a workspace member (default editor on a shared board), but an
    // explicit viewer grant must win.
    await t.asAdmin();
    await t.db.query(
      `insert into public.board_members (board_id, user_id, role) values ($1, $2, 'viewer')`,
      [sharedBoard, carol],
    );

    await t.asUser(carol);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.board_snapshots (board_id, version, snapshot) values ($1, 99, '{}'::jsonb)`,
        [sharedBoard],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("treats an archived board as read-only", async () => {
    await t.asUser(bob);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.board_snapshots (board_id, version, snapshot) values ($1, 1, '{}'::jsonb)`,
        [archivedBoard],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });
});

describe("privilege escalation", () => {
  it("prevents an admin from promoting themselves to workspace owner", async () => {
    await t.asUser(carol);
    const message = await expectDenied(() =>
      t.db.query(
        `update public.workspace_members set role = 'owner' where workspace_id = $1 and user_id = $2`,
        [acme, carol],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("prevents anyone from reassigning workspace ownership through the API", async () => {
    // owner_id carries no UPDATE grant, so this fails at the privilege layer
    // before any policy is consulted.
    await t.asUser(carol);
    const message = await expectDenied(() =>
      t.db.query(`update public.workspaces set owner_id = $1 where id = $2`, [carol, acme]),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it("prevents an admin from removing the workspace owner", async () => {
    await t.asUser(carol);
    await t.db.query(
      `delete from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [acme, alice],
    );
    await t.asAdmin();
    const still = await t.db.query(
      `select 1 from public.workspace_members where workspace_id = $1 and user_id = $2 and role = 'owner'`,
      [acme, alice],
    );
    expect(still.rows).toHaveLength(1);
  });

  it("prevents a plain member from changing another member's role", async () => {
    await t.asUser(bob);
    const before = await t.db.query<{ role: string }>(
      `select role from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [acme, carol],
    );
    await t.db.query(
      `update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`,
      [acme, carol],
    );
    await t.asAdmin();
    const after = await t.db.query<{ role: string }>(
      `select role from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [acme, carol],
    );
    expect(after.rows[0]!.role).toBe(before.rows[0]!.role);
  });

  it("lets a member leave a workspace but not the owner", async () => {
    await t.asUser(bob);
    await t.db.query(
      `delete from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [acme, bob],
    );
    await t.asAdmin();
    const gone = await t.db.query(
      `select 1 from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [acme, bob],
    );
    expect(gone.rows).toHaveLength(0);

    // Restore for any later assertions.
    await t.db.query(
      `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
      [acme, bob],
    );
  });
});

describe("comments", () => {
  let bobComment: string;

  it("lets a board viewer post a comment", async () => {
    await t.asUser(bob);
    const result = await t.db.query<{ id: string }>(
      `insert into public.comments (board_id, author_id, body) values ($1, $2, 'Looks good') returning id`,
      [sharedBoard, bob],
    );
    bobComment = result.rows[0]!.id;
    expect(bobComment).toBeTruthy();
  });

  it("refuses a comment attributed to another user", async () => {
    await t.asUser(bob);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.comments (board_id, author_id, body) values ($1, $2, 'Forged')`,
        [sharedBoard, alice],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("stops a board editor from rewriting somebody else's comment body", async () => {
    await t.asUser(alice);
    const message = await expectDenied(() =>
      t.db.query(`update public.comments set body = 'Tampered' where id = $1`, [bobComment]),
    );
    expect(message).toMatch(/only the comment author/i);
  });

  it("still lets a board editor resolve somebody else's comment", async () => {
    await t.asUser(alice);
    await t.db.query(`update public.comments set resolved_at = now() where id = $1`, [bobComment]);
    const result = await t.db.query<{ resolved_at: string | null }>(
      `select resolved_at from public.comments where id = $1`,
      [bobComment],
    );
    expect(result.rows[0]!.resolved_at).not.toBeNull();
  });

  it("hides comments on a board the user cannot see", async () => {
    await t.asUser(mallory);
    const result = await t.db.query(`select id from public.comments where board_id = $1`, [
      sharedBoard,
    ]);
    expect(result.rows).toHaveLength(0);
  });
});

describe("activity log integrity", () => {
  it("refuses an entry attributed to another actor", async () => {
    await t.asUser(bob);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.activity_logs (workspace_id, actor_id, event_type) values ($1, $2, 'board.created')`,
        [acme, alice],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("is append-only — no update or delete privilege exists", async () => {
    await t.asUser(bob);
    await t.db.query(
      `insert into public.activity_logs (workspace_id, actor_id, event_type) values ($1, $2, 'board.created')`,
      [acme, bob],
    );

    const updateMessage = await expectDenied(() =>
      t.db.query(
        `update public.activity_logs set event_type = 'board.deleted' where actor_id = $1`,
        [bob],
      ),
    );
    expect(updateMessage).toMatch(/permission denied/i);

    const deleteMessage = await expectDenied(() =>
      t.db.query(`delete from public.activity_logs where actor_id = $1`, [bob]),
    );
    expect(deleteMessage).toMatch(/permission denied/i);
  });
});

describe("invitations", () => {
  beforeAll(async () => {
    await t.asAdmin();
    await t.db.query(
      `insert into public.invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
       values ($1, 'invitee@example.com', 'member', repeat('a', 64), $2, now() + interval '7 days')`,
      [acme, alice],
    );
  });

  it("hides invitation token hashes from ordinary members", async () => {
    await t.asUser(bob);
    const result = await t.db.query(
      `select token_hash from public.invitations where workspace_id = $1`,
      [acme],
    );
    expect(result.rows).toHaveLength(0);
  });

  it("shows workspace invitations to admins", async () => {
    await t.asUser(carol);
    const result = await t.db.query(`select id from public.invitations where workspace_id = $1`, [
      acme,
    ]);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("hides invitations from a foreign workspace entirely", async () => {
    await t.asUser(mallory);
    const result = await t.db.query(`select id from public.invitations`);
    expect(result.rows).toHaveLength(0);
  });

  it("rejects a workspace invitation carrying a board role", async () => {
    await t.asAdmin();
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
         values ($1, 'x@example.com', 'editor', repeat('b', 64), $2, now() + interval '7 days')`,
        [acme, alice],
      ),
    );
    expect(message).toMatch(/invitations_role_matches_target/i);
  });
});

describe("profile privacy", () => {
  it("hides the profile of a user with no shared workspace", async () => {
    await t.asUser(mallory);
    const result = await t.db.query(`select id from public.profiles where id = $1`, [alice]);
    expect(result.rows).toHaveLength(0);
  });

  it("shows profiles of workspace colleagues", async () => {
    await t.asUser(bob);
    const result = await t.db.query(`select id from public.profiles where id = $1`, [alice]);
    expect(result.rows).toHaveLength(1);
  });

  it("prevents editing another user's profile", async () => {
    await t.asUser(bob);
    await t.db.query(`update public.profiles set display_name = 'Hacked' where id = $1`, [alice]);
    await t.asAdmin();
    const result = await t.db.query<{ display_name: string }>(
      `select display_name from public.profiles where id = $1`,
      [alice],
    );
    expect(result.rows[0]!.display_name).toBe("Alice");
  });
});

describe("anonymous access", () => {
  it("exposes nothing at all to an unauthenticated visitor", async () => {
    await t.asAnon();
    for (const table of [
      "profiles",
      "workspaces",
      "workspace_members",
      "boards",
      "board_members",
      "invitations",
      "comments",
      "activity_logs",
      "board_snapshots",
    ]) {
      const message = await expectDenied(() => t.db.query(`select * from public.${table}`));
      expect(message, `anon should not read ${table}`).toMatch(/permission denied/i);
    }
  });
});

describe("automatic provisioning", () => {
  it("creates a profile for every new auth user", async () => {
    const id = await t.createUser("newcomer@example.com", "Newcomer");
    await t.asAdmin();
    const result = await t.db.query<{ display_name: string }>(
      `select display_name from public.profiles where id = $1`,
      [id],
    );
    expect(result.rows[0]!.display_name).toBe("Newcomer");
  });

  it("falls back to the email local part when no name is supplied", async () => {
    await t.asAdmin();
    const inserted = await t.db.query<{ id: string }>(
      `insert into auth.users (email) values ('nameless@example.com') returning id`,
    );
    const result = await t.db.query<{ display_name: string }>(
      `select display_name from public.profiles where id = $1`,
      [inserted.rows[0]!.id],
    );
    expect(result.rows[0]!.display_name).toBe("nameless");
  });

  it("makes the workspace creator its owner-member automatically", async () => {
    await t.asAdmin();
    const ws = await t.db.query<{ id: string }>(
      `insert into public.workspaces (name, slug, owner_id) values ('Solo', 'solo', $1) returning id`,
      [bob],
    );
    const result = await t.db.query<{ role: string }>(
      `select role from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [ws.rows[0]!.id, bob],
    );
    expect(result.rows[0]!.role).toBe("owner");
  });
});
