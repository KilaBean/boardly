// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, expectDenied, type TestDb } from "../helpers/database";

/**
 * Snapshot persistence against the real schema and policies.
 *
 * The canvas writes here on a timer, from whoever has the board open — so the
 * interesting questions are who is allowed to write, and what happens when two
 * collaborators claim the same version at once.
 */

let t: TestDb;
let owner: string;
let editor: string;
let viewer: string;
let outsider: string;
let workspaceId: string;
let boardId: string;
let archivedBoardId: string;

beforeAll(async () => {
  t = await createTestDb();

  owner = await t.createUser("snap-owner@example.com", "Owner");
  editor = await t.createUser("snap-editor@example.com", "Editor");
  viewer = await t.createUser("snap-viewer@example.com", "Viewer");
  outsider = await t.createUser("snap-outsider@example.com", "Outsider");

  await t.asAdmin();
  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Snap', 'snap', $1) returning id`,
    [owner],
  );
  workspaceId = ws.rows[0]!.id;

  await t.db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [workspaceId, editor],
  );

  const board = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Canvas', $2, 'workspace') returning id`,
    [workspaceId, owner],
  );
  boardId = board.rows[0]!.id;

  // Explicit viewer grant overrides the workspace-wide editor default.
  await t.db.query(
    `insert into public.board_members (board_id, user_id, role) values ($1, $2, 'viewer')`,
    [boardId, viewer],
  );

  const archived = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility, archived_at)
     values ($1, 'Archived', $2, 'workspace', now()) returning id`,
    [workspaceId, owner],
  );
  archivedBoardId = archived.rows[0]!.id;
});

afterAll(async () => {
  await t?.close();
});

describe("who may write a snapshot", () => {
  it("lets the board owner save", async () => {
    await t.asUser(owner);
    await t.db.query(
      `insert into public.board_snapshots (board_id, version, snapshot)
       values ($1, 1, '{"store":{}}'::jsonb)`,
      [boardId],
    );

    const result = await t.db.query(
      `select version from public.board_snapshots where board_id = $1`,
      [boardId],
    );
    expect(result.rows).toHaveLength(1);
  });

  it("lets a workspace member save on a workspace-visible board", async () => {
    await t.asUser(editor);
    await t.db.query(
      `insert into public.board_snapshots (board_id, version, snapshot)
       values ($1, 2, '{"store":{}}'::jsonb)`,
      [boardId],
    );
    expect(true).toBe(true);
  });

  it("refuses a viewer", async () => {
    // The read-only editor state is a UI affordance; this is the real barrier.
    await t.asUser(viewer);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.board_snapshots (board_id, version, snapshot)
         values ($1, 3, '{"store":{}}'::jsonb)`,
        [boardId],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("refuses somebody with no access at all", async () => {
    await t.asUser(outsider);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.board_snapshots (board_id, version, snapshot)
         values ($1, 4, '{"store":{}}'::jsonb)`,
        [boardId],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("refuses writes to an archived board", async () => {
    await t.asUser(owner);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.board_snapshots (board_id, version, snapshot)
         values ($1, 1, '{"store":{}}'::jsonb)`,
        [archivedBoardId],
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });
});

describe("who may read a snapshot", () => {
  it("lets a viewer read", async () => {
    await t.asUser(viewer);
    const result = await t.db.query(
      `select version from public.board_snapshots where board_id = $1`,
      [boardId],
    );
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("hides snapshots from somebody with no board access", async () => {
    await t.asUser(outsider);
    const result = await t.db.query(
      `select version from public.board_snapshots where board_id = $1`,
      [boardId],
    );
    expect(result.rows).toHaveLength(0);
  });
});

describe("versioning", () => {
  it("rejects a duplicate version, which is what makes retrying correct", async () => {
    // Two collaborators autosaving at the same moment compute the same next
    // version. The unique index is the arbiter; the action retries on 23505.
    await t.asUser(owner);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.board_snapshots (board_id, version, snapshot)
         values ($1, 1, '{"store":{}}'::jsonb)`,
        [boardId],
      ),
    );
    expect(message).toMatch(/duplicate key|unique/i);
  });

  it("keeps version history rather than overwriting", async () => {
    await t.asAdmin();
    const result = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.board_snapshots where board_id = $1`,
      [boardId],
    );
    expect(Number(result.rows[0]!.count)).toBeGreaterThanOrEqual(2);
  });

  it("is immutable — no UPDATE privilege exists", async () => {
    await t.asUser(owner);
    const message = await expectDenied(() =>
      t.db.query(`update public.board_snapshots set version = 99 where board_id = $1`, [boardId]),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it("rejects a non-object snapshot", async () => {
    // Mirrors the guard in saveBoardSnapshotAction.
    await t.asUser(owner);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.board_snapshots (board_id, version, snapshot)
         values ($1, 50, '[]'::jsonb)`,
        [boardId],
      ),
    );
    expect(message).toMatch(/board_snapshots_snapshot_is_object/i);
  });

  it("rejects a non-positive version", async () => {
    await t.asUser(owner);
    const message = await expectDenied(() =>
      t.db.query(
        `insert into public.board_snapshots (board_id, version, snapshot)
         values ($1, 0, '{}'::jsonb)`,
        [boardId],
      ),
    );
    expect(message).toMatch(/board_snapshots_version_positive/i);
  });
});
