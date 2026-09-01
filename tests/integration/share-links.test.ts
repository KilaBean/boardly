// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, expectDenied, type TestDb } from "../helpers/database";

/**
 * Share links.
 *
 * ADR 0002 flagged that `share_link_enabled` alone is not a security
 * mechanism — a boolean grants access to anyone who learns the board id. The
 * token that fixes it lives in `board_share_links`, a table no API role can
 * read, after column-level grants on `boards` turned out to break `count(*)`
 * (see migration 20260825000400).
 */

let t: TestDb;
let owner: string;
let member: string;
let workspaceId: string;
let boardId: string;

const TOKEN_HASH = "a".repeat(64);

beforeAll(async () => {
  t = await createTestDb();

  owner = await t.createUser("share-owner@example.com", "Owner");
  member = await t.createUser("share-member@example.com", "Member");

  await t.asAdmin();
  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Share', 'share', $1) returning id`,
    [owner],
  );
  workspaceId = ws.rows[0]!.id;

  await t.db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [workspaceId, member],
  );

  const board = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Shared', $2, 'workspace') returning id`,
    [workspaceId, owner],
  );
  boardId = board.rows[0]!.id;
});

afterAll(async () => {
  await t?.close();
});

describe("creating a link enables sharing", () => {
  it("flips the board's flag via the trigger", async () => {
    // The invariant is structural: the flag cannot drift from reality because
    // nothing but the trigger sets it.
    await t.asServiceRole();
    await t.db.query(
      `insert into public.board_share_links (board_id, token_hash) values ($1, $2)`,
      [boardId, TOKEN_HASH],
    );

    const result = await t.db.query<{ share_link_enabled: boolean }>(
      `select share_link_enabled from public.boards where id = $1`,
      [boardId],
    );
    expect(result.rows[0]!.share_link_enabled).toBe(true);
  });

  it("clears the flag when the link is deleted", async () => {
    await t.asServiceRole();
    await t.db.query(`delete from public.board_share_links where board_id = $1`, [boardId]);

    const result = await t.db.query<{ share_link_enabled: boolean }>(
      `select share_link_enabled from public.boards where id = $1`,
      [boardId],
    );
    expect(result.rows[0]!.share_link_enabled).toBe(false);

    // Restore for later cases.
    await t.db.query(
      `insert into public.board_share_links (board_id, token_hash) values ($1, $2)`,
      [boardId, TOKEN_HASH],
    );
  });

  it("keeps at most one link per board", async () => {
    await t.asServiceRole();
    const message = await expectDenied(() =>
      t.db.query(`insert into public.board_share_links (board_id, token_hash) values ($1, $2)`, [
        boardId,
        "c".repeat(64),
      ]),
    );
    expect(message).toMatch(/duplicate key|unique/i);
  });

  it("rejects a hash too short to be a real digest", async () => {
    await t.asServiceRole();
    const message = await expectDenied(() =>
      t.db.query(`update public.board_share_links set token_hash = 'abc' where board_id = $1`, [
        boardId,
      ]),
    );
    expect(message).toMatch(/board_share_links_token_hash_length/i);
  });

  it("keeps token hashes unique across boards", async () => {
    await t.asAdmin();
    const other = await t.db.query<{ id: string }>(
      `insert into public.boards (workspace_id, name, owner_id) values ($1, 'Other', $2) returning id`,
      [workspaceId, owner],
    );

    await t.asServiceRole();
    const message = await expectDenied(() =>
      t.db.query(`insert into public.board_share_links (board_id, token_hash) values ($1, $2)`, [
        other.rows[0]!.id,
        TOKEN_HASH,
      ]),
    );
    expect(message).toMatch(/duplicate key|unique/i);
  });
});

describe("the token table is unreachable through the API", () => {
  it("refuses to select it as the board owner", async () => {
    // Even the owner cannot read it back — that is why "regenerate" exists
    // instead of "show me the link again".
    await t.asUser(owner);
    const message = await expectDenied(() =>
      t.db.query(`select token_hash from public.board_share_links where board_id = $1`, [boardId]),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it("refuses to select it as a workspace member", async () => {
    await t.asUser(member);
    const message = await expectDenied(() =>
      t.db.query(`select token_hash from public.board_share_links`),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it("refuses anonymous access", async () => {
    await t.asAnon();
    const message = await expectDenied(() =>
      t.db.query(`select token_hash from public.board_share_links`),
    );
    expect(message).toMatch(/permission denied/i);
  });
});

describe("boards remain fully readable", () => {
  it("allows select * — the column-grant fragility is gone", async () => {
    // The regression that sent every user to onboarding: `count(*)` needs
    // table-level SELECT, which column grants do not provide.
    await t.asUser(member);
    const result = await t.db.query(`select * from public.boards where id = $1`, [boardId]);
    expect(result.rows).toHaveLength(1);
  });

  it("allows count(*), which listWorkspaces depends on", async () => {
    await t.asUser(member);
    const result = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.boards where workspace_id = $1`,
      [workspaceId],
    );
    expect(Number(result.rows[0]!.count)).toBeGreaterThan(0);
  });

  it("still refuses to let a client fake the shared flag", async () => {
    await t.asUser(owner);
    const message = await expectDenied(() =>
      t.db.query(`update public.boards set share_link_enabled = true where id = $1`, [boardId]),
    );
    expect(message).toMatch(/permission denied/i);
  });
});
