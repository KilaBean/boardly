// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/database";

/**
 * Privileges of the `service_role` — the identity `createAdminClient()` uses.
 *
 * This suite exists because of a bug that shipped and survived eight phases of
 * testing: current Supabase default privileges grant **no DML** on new public
 * tables to `anon`, `authenticated` *or* `service_role`. The migrations
 * granted `authenticated` what it needed but never granted `service_role`
 * anything, so the admin client could not read or write a single table.
 *
 * It went unnoticed because every other integration suite seeds as the
 * superuser (`asAdmin`), which sees no grant errors at all. Only running
 * against a real Supabase stack surfaced it — `resolveShareToken()` reads
 * `boards` through the service role, so every share link would have 404ed in
 * production.
 *
 * Everything here therefore runs as the real role, not the superuser.
 */

let t: TestDb;
let owner: string;
let workspaceId: string;
let boardId: string;

beforeAll(async () => {
  t = await createTestDb();
  owner = await t.createUser("svc-owner@example.com", "Owner");

  await t.asAdmin();
  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Svc', 'svc', $1) returning id`,
    [owner],
  );
  workspaceId = ws.rows[0]!.id;

  const board = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id) values ($1, 'Svc board', $2) returning id`,
    [workspaceId, owner],
  );
  boardId = board.rows[0]!.id;
});

afterAll(async () => {
  await t?.close();
});

describe("the admin client can perform the operations it is used for", () => {
  it("reads the share-link table, which no other role may touch", async () => {
    await t.asServiceRole();
    const result = await t.db.query(`select board_id, token_hash from public.board_share_links`);
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("enables and rotates a share link", async () => {
    await t.asServiceRole();
    await t.db.query(
      `insert into public.board_share_links (board_id, token_hash) values ($1, $2)`,
      [boardId, "a".repeat(64)],
    );

    const rotated = await t.db.query<{ token_hash: string }>(
      `update public.board_share_links set token_hash = $2 where board_id = $1 returning token_hash`,
      [boardId, "b".repeat(64)],
    );
    expect(rotated.rows[0]!.token_hash).toBe("b".repeat(64));
  });

  it("resolves a board by its share token hash", async () => {
    // The exact two-step lookup behind /share/<token>.
    await t.asServiceRole();
    const link = await t.db.query<{ board_id: string }>(
      `select board_id from public.board_share_links where token_hash = $1`,
      ["b".repeat(64)],
    );
    expect(link.rows).toHaveLength(1);

    const result = await t.db.query<{ name: string }>(
      `select id, name from public.boards
       where id = $1 and share_link_enabled = true and archived_at is null`,
      [link.rows[0]!.board_id],
    );
    expect(result.rows[0]!.name).toBe("Svc board");
  });

  it("reads board snapshots for the public share view", async () => {
    await t.asAdmin();
    await t.db.query(
      `insert into public.board_snapshots (board_id, version, snapshot) values ($1, 1, '{}'::jsonb)`,
      [boardId],
    );

    await t.asServiceRole();
    const result = await t.db.query(
      `select snapshot from public.board_snapshots where board_id = $1`,
      [boardId],
    );
    expect(result.rows).toHaveLength(1);
  });

  it("can seed users, workspaces and memberships", async () => {
    // What the E2E seeding helpers do.
    await t.asServiceRole();
    const inserted = await t.db.query<{ id: string }>(
      `insert into public.workspaces (name, slug, owner_id) values ('Seeded', 'seeded-svc', $1) returning id`,
      [owner],
    );
    expect(inserted.rows[0]!.id).toBeTruthy();

    await t.db.query(
      `insert into public.board_members (board_id, user_id, role) values ($1, $2, 'viewer')`,
      [boardId, owner],
    );
    await t.db.query(`delete from public.board_members where board_id = $1`, [boardId]);
  });
});

describe("anon remains locked out", () => {
  it("still has no access to any table", async () => {
    // The service-role grant must not have loosened anything for anon.
    await t.asAnon();
    for (const table of ["boards", "workspaces", "comments", "invitations"]) {
      let denied = false;
      try {
        await t.db.query(`select * from public.${table}`);
      } catch {
        denied = true;
      }
      expect(denied, `anon should not read ${table}`).toBe(true);
    }
  });
});
