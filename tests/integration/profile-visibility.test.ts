// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/database";

/**
 * Whether you can see the name of somebody you are working with.
 *
 * Reported from production: a board shared with an outside collaborator showed
 * their name on the canvas but "Someone" in the activity feed. The canvas gets
 * names over Yjs awareness — sent client to client, never read from the
 * database — so it kept working while every database-backed name did not.
 *
 * The cause was that profile visibility was defined purely in terms of shared
 * *workspaces*, while a board invitation grants board membership only. Two
 * people could therefore collaborate on a board all day without being allowed
 * to read each other's display name.
 *
 * It is worse than a wrong label: `listBoardMembers` and the comments query
 * both join `profiles!inner`, so an unreadable profile removes the row
 * entirely — a collaborator vanishes from "People with access", and their
 * comments disappear from the panel.
 */

let t: TestDb;

let owner: string; // owns the workspace and the board
let guest: string; // invited to the board only — not a workspace member
let colleague: string; // shares the workspace, not the board
let stranger: string; // shares nothing

let board: string;

beforeAll(async () => {
  t = await createTestDb();

  owner = await t.createUser("owner@example.com", "Board Owner");
  guest = await t.createUser("guest@example.com", "Kweku Kratos");
  colleague = await t.createUser("colleague@example.com", "Colleague");
  stranger = await t.createUser("stranger@example.com", "Stranger");

  await t.asAdmin();

  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Acme', 'acme', $1) returning id`,
    [owner],
  );
  const workspace = ws.rows[0]!.id;

  await t.db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [workspace, colleague],
  );

  const b = await t.db.query<{ id: string }>(
    `insert into public.boards (workspace_id, name, owner_id, visibility)
     values ($1, 'Private board', $2, 'private') returning id`,
    [workspace, owner],
  );
  board = b.rows[0]!.id;

  // Exactly what accepting a board invitation does: board membership, and
  // deliberately no workspace membership.
  await t.db.query(
    `insert into public.board_members (board_id, user_id, role) values ($1, $2, 'editor')`,
    [board, guest],
  );
});

afterAll(async () => {
  await t?.close();
});

async function readableProfiles(viewer: string): Promise<string[]> {
  await t.asUser(viewer);
  const result = await t.db.query<{ display_name: string }>(
    `select display_name from public.profiles order by display_name`,
  );
  return result.rows.map((row) => row.display_name);
}

describe("a board-only collaborator", () => {
  it("is visible to the board owner", async () => {
    // The reported bug: this came back empty, so the activity feed rendered
    // "Someone" and the members list dropped them.
    expect(await readableProfiles(owner)).toContain("Kweku Kratos");
  });

  it("can see the board owner back", async () => {
    // Symmetry matters: otherwise the guest sees "Someone" created the board.
    expect(await readableProfiles(guest)).toContain("Board Owner");
  });

  it("does not gain sight of the rest of the workspace", async () => {
    // Being invited to one board is not being invited to the team.
    expect(await readableProfiles(guest)).not.toContain("Colleague");
  });
});

describe("existing visibility is unchanged", () => {
  it("still shows workspace colleagues to each other", async () => {
    expect(await readableProfiles(owner)).toContain("Colleague");
  });

  it("always shows you your own profile", async () => {
    expect(await readableProfiles(stranger)).toContain("Stranger");
  });

  it("shows a stranger nobody else", async () => {
    // The negative control. If this ever passes trivially, the policy has
    // stopped filtering at all.
    expect(await readableProfiles(stranger)).toEqual(["Stranger"]);
  });

  it("hides the board guest from an unrelated user", async () => {
    expect(await readableProfiles(colleague)).not.toContain("Kweku Kratos");
  });
});

describe("the queries that actually broke", () => {
  it("keeps a board-only member in the members list", async () => {
    await t.asUser(owner);
    // Mirrors listBoardMembers, whose `profiles!inner` join drops any row
    // whose profile is unreadable.
    const result = await t.db.query<{ display_name: string }>(
      `select p.display_name
         from public.board_members bm
         join public.profiles p on p.id = bm.user_id
        where bm.board_id = $1`,
      [board],
    );
    expect(result.rows.map((r) => r.display_name)).toContain("Kweku Kratos");
  });

  it("resolves the actor name on an activity row", async () => {
    await t.asAdmin();
    await t.db.query(
      `insert into public.activity_logs (workspace_id, board_id, actor_id, event_type, metadata)
       select workspace_id, id, $1, 'member.joined', '{"role":"editor"}'::jsonb
         from public.boards where id = $2`,
      [guest, board],
    );

    await t.asUser(owner);
    const result = await t.db.query<{ display_name: string | null }>(
      `select p.display_name
         from public.activity_logs a
         left join public.profiles p on p.id = a.actor_id
        where a.event_type = 'member.joined'`,
    );

    // Null here is what the app renders as "Someone".
    expect(result.rows[0]?.display_name).toBe("Kweku Kratos");
  });
});
