// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, expectDenied, type TestDb } from "../helpers/database";

/**
 * Share links that grant editing.
 *
 * A share link is a bearer credential and `/share/<token>` is the only route
 * reachable with no session, so this is the one place where widening access
 * has the largest blast radius. An edit link therefore does not grant writing
 * to whoever holds it — it is redeemed by a signed-in user and becomes
 * ordinary board membership.
 *
 * Everything below is about what `redeem_share_link` refuses.
 */

let t: TestDb;

let owner: string;
let visitor: string;
let board: string;
let workspace: string;

const EDIT_TOKEN = "a".repeat(64);
const VIEW_TOKEN = "b".repeat(64);

beforeAll(async () => {
  t = await createTestDb();

  owner = await t.createUser("owner@example.com", "Owner");
  visitor = await t.createUser("visitor@example.com", "Visitor");

  await t.asAdmin();

  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Acme', 'acme', $1) returning id`,
    [owner],
  );
  workspace = ws.rows[0]!.id;

  const b = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Board', $2, 'private') returning id`,
    [workspace, owner],
  );
  board = b.rows[0]!.id;
});

afterAll(async () => {
  await t?.close();
});

/** Puts the board back to "one edit link, nobody joined". */
beforeEach(async () => {
  await t.asAdmin();
  await t.db.query(`delete from public.board_members where board_id = $1`, [board]);
  await t.db.query(`delete from public.board_share_links where board_id = $1`, [board]);
  await t.db.query(`update public.boards set archived_at = null where id = $1`, [board]);
  await t.db.query(
    `insert into public.board_share_links (board_id, token_hash, role) values ($1, $2, 'editor')`,
    [board, EDIT_TOKEN],
  );
});

describe("the link carries its access level", () => {
  it("defaults to viewer when none is given", async () => {
    await t.asAdmin();
    await t.db.query(`delete from public.board_share_links where board_id = $1`, [board]);
    await t.db.query(
      `insert into public.board_share_links (board_id, token_hash) values ($1, $2)`,
      [board, VIEW_TOKEN],
    );

    // The safe default: a link created without a decision grants the less
    // dangerous thing.
    const result = await t.db.query<{ role: string }>(
      `select role from public.board_share_links where board_id = $1`,
      [board],
    );
    expect(result.rows[0]?.role).toBe("viewer");
  });

  it("mirrors the level onto the board for the UI to read", async () => {
    const result = await t.db.query<{
      share_link_enabled: boolean;
      share_link_role: string | null;
    }>(`select share_link_enabled, share_link_role from public.boards where id = $1`, [board]);
    expect(result.rows[0]).toMatchObject({ share_link_enabled: true, share_link_role: "editor" });
  });

  it("clears the mirrored level when the link is revoked", async () => {
    await t.asAdmin();
    await t.db.query(`delete from public.board_share_links where board_id = $1`, [board]);

    // Otherwise a revoked board would still advertise "edit link active".
    const result = await t.db.query<{
      share_link_enabled: boolean;
      share_link_role: string | null;
    }>(`select share_link_enabled, share_link_role from public.boards where id = $1`, [board]);
    expect(result.rows[0]).toMatchObject({ share_link_enabled: false, share_link_role: null });
  });
});

describe("redeeming an edit link", () => {
  it("makes the visitor an editor", async () => {
    await t.asUser(visitor);
    await t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]);

    await t.asAdmin();
    const result = await t.db.query<{ role: string }>(
      `select role from public.board_members where board_id = $1 and user_id = $2`,
      [board, visitor],
    );
    expect(result.rows[0]?.role).toBe("editor");
  });

  it("gives them edit rights the policies agree with", async () => {
    await t.asUser(visitor);
    await t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]);

    const result = await t.db.query<{ can_edit: boolean }>(
      `select public.can_edit_board($1) as can_edit`,
      [board],
    );
    expect(result.rows[0]?.can_edit).toBe(true);
  });

  it("records the join so the owner can see who arrived", async () => {
    await t.asUser(visitor);
    await t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]);

    await t.asAdmin();
    const result = await t.db.query<{ event_type: string; metadata: { via?: string } }>(
      `select event_type, metadata from public.activity_logs where actor_id = $1`,
      [visitor],
    );
    expect(result.rows[0]?.event_type).toBe("member.joined");
    expect(result.rows[0]?.metadata.via).toBe("share_link");
  });

  it("is idempotent", async () => {
    await t.asUser(visitor);
    await t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]);
    await t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]);

    await t.asAdmin();
    const result = await t.db.query<{ count: number | string }>(
      `select count(*) from public.board_members where board_id = $1 and user_id = $2`,
      [board, visitor],
    );
    expect(Number(result.rows[0]?.count)).toBe(1);
  });

  it("upgrades an existing viewer rather than refusing", async () => {
    await t.asAdmin();
    await t.db.query(
      `insert into public.board_members (board_id, user_id, role) values ($1, $2, 'viewer')`,
      [board, visitor],
    );

    await t.asUser(visitor);
    await t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]);

    await t.asAdmin();
    const result = await t.db.query<{ role: string }>(
      `select role from public.board_members where board_id = $1 and user_id = $2`,
      [board, visitor],
    );
    expect(result.rows[0]?.role).toBe("editor");
  });

  it("does not add a membership row for the owner", async () => {
    await t.asUser(owner);
    await t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]);

    await t.asAdmin();
    const result = await t.db.query<{ count: number | string }>(
      `select count(*) from public.board_members where board_id = $1`,
      [board],
    );
    expect(Number(result.rows[0]?.count)).toBe(0);
  });
});

describe("what it refuses", () => {
  it("refuses an anonymous caller", async () => {
    await t.asAnon();
    // The whole point of the design: holding the token is not enough.
    await expectDenied(() => t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]));
  });

  it("refuses a view-only link", async () => {
    await t.asAdmin();
    await t.db.query(`delete from public.board_share_links where board_id = $1`, [board]);
    await t.db.query(
      `insert into public.board_share_links (board_id, token_hash, role) values ($1, $2, 'viewer')`,
      [board, VIEW_TOKEN],
    );

    await t.asUser(visitor);
    await expectDenied(() => t.db.query(`select public.redeem_share_link($1)`, [VIEW_TOKEN]));
  });

  it("refuses a token that does not exist", async () => {
    await t.asUser(visitor);
    await expectDenied(() => t.db.query(`select public.redeem_share_link($1)`, ["c".repeat(64)]));
  });

  it("refuses a revoked link", async () => {
    await t.asAdmin();
    await t.db.query(`delete from public.board_share_links where board_id = $1`, [board]);

    await t.asUser(visitor);
    await expectDenied(() => t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]));
  });

  it("refuses while the board is archived", async () => {
    await t.asAdmin();
    await t.db.query(`update public.boards set archived_at = now() where id = $1`, [board]);

    // An archived board is read-only for its own editors; a link must not be
    // a way around that.
    await t.asUser(visitor);
    await expectDenied(() => t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]));
  });

  it("leaves no membership behind when it refuses", async () => {
    await t.asAdmin();
    await t.db.query(`update public.boards set archived_at = now() where id = $1`, [board]);

    await t.asUser(visitor);
    await expectDenied(() => t.db.query(`select public.redeem_share_link($1)`, [EDIT_TOKEN]));

    await t.asAdmin();
    const result = await t.db.query<{ count: number | string }>(
      `select count(*) from public.board_members where board_id = $1`,
      [board],
    );
    expect(Number(result.rows[0]?.count)).toBe(0);
  });
});
