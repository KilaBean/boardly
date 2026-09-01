// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/database";

/**
 * `INSERT ... RETURNING` under RLS.
 *
 * PostgREST appends RETURNING to every insert that requests a representation,
 * which is what `.insert(...).select(...)` compiles to — the shape every
 * server action in this codebase uses. RETURNING must satisfy the **SELECT**
 * policy as well as the INSERT policy.
 *
 * That combination shipped broken: `boards_select` called a STABLE function
 * that re-read `boards`, so the row being inserted was invisible to it and
 * board creation failed for everyone. The RLS suite missed it because it
 * inserts either as the superuser or without RETURNING.
 *
 * Every test here therefore inserts **as an ordinary authenticated user, with
 * RETURNING** — mirroring what the application actually sends.
 */

let t: TestDb;
let owner: string;
let member: string;
let workspaceId: string;
let boardId: string;

beforeAll(async () => {
  t = await createTestDb();

  owner = await t.createUser("ret-owner@example.com", "Owner");
  member = await t.createUser("ret-member@example.com", "Member");

  await t.asAdmin();
  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Ret', 'ret', $1) returning id`,
    [owner],
  );
  workspaceId = ws.rows[0]!.id;

  await t.db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [workspaceId, member],
  );

  const board = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Existing', $2, 'workspace') returning id`,
    [workspaceId, owner],
  );
  boardId = board.rows[0]!.id;
});

afterAll(async () => {
  await t?.close();
});

describe("creating a board returns the new row", () => {
  it("works for the workspace owner", async () => {
    // The exact statement createBoardAction produces.
    await t.asUser(owner);
    const result = await t.db.query<{ id: string; name: string }>(
      `insert into public.boards (workspace_id, name, owner_id, visibility)
       values ($1, 'Owner board', $2, 'workspace') returning id, name`,
      [workspaceId, owner],
    );
    expect(result.rows[0]!.name).toBe("Owner board");
  });

  it("works for an ordinary workspace member", async () => {
    await t.asUser(member);
    const result = await t.db.query<{ id: string }>(
      `insert into public.boards (workspace_id, name, owner_id, visibility)
       values ($1, 'Member board', $2, 'workspace') returning id`,
      [workspaceId, member],
    );
    expect(result.rows[0]!.id).toBeTruthy();
  });

  it("works for a private board, which the creator alone can see", async () => {
    // The branch that matters most: nothing but `owner_id` on the new row can
    // establish visibility here.
    await t.asUser(member);
    const result = await t.db.query<{ id: string }>(
      `insert into public.boards (workspace_id, name, owner_id, visibility)
       values ($1, 'Member private', $2, 'private') returning id`,
      [workspaceId, member],
    );
    expect(result.rows[0]!.id).toBeTruthy();
  });

  it("still refuses a board owned by somebody else", async () => {
    // The fix must not have widened the insert policy.
    await t.asUser(member);
    let denied = false;
    try {
      await t.db.query(
        `insert into public.boards (workspace_id, name, owner_id) values ($1, 'Forged', $2) returning id`,
        [workspaceId, owner],
      );
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);
  });
});

describe("other tables the application inserts with RETURNING", () => {
  it("returns a new comment to its author", async () => {
    await t.asUser(member);
    const result = await t.db.query<{ id: string }>(
      `insert into public.comments (board_id, author_id, body)
       values ($1, $2, 'Hello') returning id`,
      [boardId, member],
    );
    expect(result.rows[0]!.id).toBeTruthy();
  });

  it("returns a new board snapshot to its writer", async () => {
    await t.asUser(member);
    const result = await t.db.query<{ version: number }>(
      `insert into public.board_snapshots (board_id, version, snapshot)
       values ($1, 1, '{}'::jsonb) returning version`,
      [boardId],
    );
    expect(result.rows[0]!.version).toBe(1);
  });

  it("returns a new workspace to its creator", async () => {
    // Already correct — workspaces_select has carried the owner_id branch from
    // the start, which is what this suite generalises.
    await t.asUser(member);
    const result = await t.db.query<{ slug: string }>(
      `insert into public.workspaces (name, slug, owner_id)
       values ('Solo', 'solo-ret', $1) returning slug`,
      [member],
    );
    expect(result.rows[0]!.slug).toBe("solo-ret");
  });

  it("returns a new activity entry to its actor", async () => {
    await t.asUser(member);
    const result = await t.db.query<{ id: string }>(
      `insert into public.activity_logs (workspace_id, board_id, actor_id, event_type)
       values ($1, $2, $3, 'board.created') returning id`,
      [workspaceId, boardId, member],
    );
    expect(result.rows[0]!.id).toBeTruthy();
  });
});
