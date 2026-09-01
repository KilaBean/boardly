// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, expectDenied, type TestDb } from "../helpers/database";

/**
 * Activity feed visibility.
 *
 * The feed is the one surface that aggregates events across a whole workspace,
 * which makes it the most likely place for a private board to leak. The policy
 * requires workspace membership *and*, for board-scoped rows, `can_view_board`
 * — this suite holds it to that.
 */

let t: TestDb;
let owner: string;
let member: string;
let outsider: string;
let workspaceId: string;
let privateBoardId: string;
let sharedBoardId: string;

beforeAll(async () => {
  t = await createTestDb();

  owner = await t.createUser("act-owner@example.com", "Owner");
  member = await t.createUser("act-member@example.com", "Member");
  outsider = await t.createUser("act-outsider@example.com", "Outsider");

  await t.asAdmin();
  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Act', 'act', $1) returning id`,
    [owner],
  );
  workspaceId = ws.rows[0]!.id;

  await t.db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [workspaceId, member],
  );

  const priv = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Secret', $2, 'private') returning id`,
    [workspaceId, owner],
  );
  privateBoardId = priv.rows[0]!.id;

  const shared = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Open', $2, 'workspace') returning id`,
    [workspaceId, owner],
  );
  sharedBoardId = shared.rows[0]!.id;

  // Three events: workspace-scoped, private-board, shared-board.
  await t.db.query(
    `insert into public.activity_logs (workspace_id, board_id, actor_id, event_type, metadata)
     values ($1, null, $2, 'member.joined', '{}'::jsonb),
            ($1, $3, $2, 'board.created', '{"name":"Secret"}'::jsonb),
            ($1, $4, $2, 'board.created', '{"name":"Open"}'::jsonb)`,
    [workspaceId, owner, privateBoardId, sharedBoardId],
  );
});

afterAll(async () => {
  await t?.close();
});

describe("what a workspace member sees", () => {
  it("sees workspace-scoped events", async () => {
    await t.asUser(member);
    const result = await t.db.query(
      `select id from public.activity_logs where workspace_id = $1 and board_id is null`,
      [workspaceId],
    );
    expect(result.rows).toHaveLength(1);
  });

  it("sees events for a board they can open", async () => {
    await t.asUser(member);
    const result = await t.db.query(`select id from public.activity_logs where board_id = $1`, [
      sharedBoardId,
    ]);
    expect(result.rows).toHaveLength(1);
  });

  it("does NOT see events for a private board they cannot open", async () => {
    // The leak this suite exists to prevent: the board name lives in the
    // metadata, so a visible row would disclose a private board's existence
    // and title to the whole workspace.
    await t.asUser(member);
    const result = await t.db.query(
      `select id, metadata from public.activity_logs where board_id = $1`,
      [privateBoardId],
    );
    expect(result.rows).toHaveLength(0);
  });

  it("gets a feed containing exactly the permitted rows", async () => {
    await t.asUser(member);
    const result = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.activity_logs where workspace_id = $1`,
      [workspaceId],
    );
    // Workspace event + shared board event, but not the private board's.
    expect(Number(result.rows[0]!.count)).toBe(2);
  });
});

describe("what the board owner sees", () => {
  it("sees everything, including their private board", async () => {
    await t.asUser(owner);
    const result = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.activity_logs where workspace_id = $1`,
      [workspaceId],
    );
    expect(Number(result.rows[0]!.count)).toBe(3);
  });
});

describe("what a non-member sees", () => {
  it("sees nothing at all", async () => {
    await t.asUser(outsider);
    const result = await t.db.query(`select id from public.activity_logs where workspace_id = $1`, [
      workspaceId,
    ]);
    expect(result.rows).toHaveLength(0);
  });

  it("cannot write into the workspace's history", async () => {
    await t.asUser(outsider);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.activity_logs (workspace_id, actor_id, event_type)
         values ($1, $2, 'board.created')`,
        [workspaceId, outsider],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });
});

describe("comment visibility follows the board", () => {
  beforeAll(async () => {
    await t.asAdmin();
    await t.db.query(
      `insert into public.comments (board_id, author_id, body) values ($1, $2, 'private note')`,
      [privateBoardId, owner],
    );
    await t.db.query(
      `insert into public.comments (board_id, author_id, body) values ($1, $2, 'open note')`,
      [sharedBoardId, owner],
    );
  });

  it("hides comments on a board the member cannot open", async () => {
    await t.asUser(member);
    const result = await t.db.query(`select body from public.comments where board_id = $1`, [
      privateBoardId,
    ]);
    expect(result.rows).toHaveLength(0);
  });

  it("shows comments on a board the member can open", async () => {
    await t.asUser(member);
    const result = await t.db.query<{ body: string }>(
      `select body from public.comments where board_id = $1`,
      [sharedBoardId],
    );
    expect(result.rows[0]!.body).toBe("open note");
  });

  it("lets a member comment on a board they can view", async () => {
    await t.asUser(member);
    await t.db.query(
      `insert into public.comments (board_id, author_id, body) values ($1, $2, 'from member')`,
      [sharedBoardId, member],
    );
    const result = await t.db.query(`select id from public.comments where author_id = $1`, [
      member,
    ]);
    expect(result.rows).toHaveLength(1);
  });

  it("stops a member editing somebody else's comment body", async () => {
    await t.asUser(member);
    const message = await expectDenied(() =>
      t.db.query(
        `update public.comments set body = 'tampered' where board_id = $1 and author_id = $2`,
        [sharedBoardId, owner],
      ),
    );
    expect(message).toMatch(/only the comment author/i);
  });
});
