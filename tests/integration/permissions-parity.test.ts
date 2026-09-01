// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canEditBoard,
  canViewBoard,
  resolveBoardRole,
  type BoardAccessContext,
} from "@/lib/permissions";
import type { BoardRole, BoardVisibility } from "@/types/database";

import { createTestDb, type TestDb } from "../helpers/database";

/**
 * The board access rules exist twice: once in SQL (`board_access_role`, the
 * real security boundary) and once in TypeScript (`resolveBoardRole`, used to
 * decide what the UI offers).
 *
 * Two copies of a rule drift. This suite pins them together by running every
 * combination through both implementations and asserting they agree — so a
 * change to one without the other fails the build instead of quietly showing
 * users buttons that the database will reject.
 */

let t: TestDb;
let owner: string;
let member: string;
let outsider: string;
let workspaceId: string;

type Scenario = {
  label: string;
  actor: () => string;
  visibility: BoardVisibility;
  explicitRole: BoardRole | null;
  archived: boolean;
  isWorkspaceMember: boolean;
};

const scenarios: Scenario[] = [];

for (const visibility of ["private", "workspace"] as const) {
  for (const explicitRole of [null, "editor", "viewer"] as const) {
    for (const archived of [false, true]) {
      scenarios.push({
        label: `owner / ${visibility} / explicit=${explicitRole ?? "none"} / archived=${archived}`,
        actor: () => owner,
        visibility,
        explicitRole,
        archived,
        isWorkspaceMember: true,
      });
      scenarios.push({
        label: `member / ${visibility} / explicit=${explicitRole ?? "none"} / archived=${archived}`,
        actor: () => member,
        visibility,
        explicitRole,
        archived,
        isWorkspaceMember: true,
      });
      scenarios.push({
        label: `outsider / ${visibility} / explicit=${explicitRole ?? "none"} / archived=${archived}`,
        actor: () => outsider,
        visibility,
        explicitRole,
        archived,
        isWorkspaceMember: false,
      });
    }
  }
}

beforeAll(async () => {
  t = await createTestDb();

  owner = await t.createUser("owner@example.com", "Owner");
  member = await t.createUser("member@example.com", "Member");
  outsider = await t.createUser("outsider@example.com", "Outsider");

  await t.asAdmin();
  const ws = await t.db.query<{ id: string }>(
    `insert into public.workspaces (name, slug, owner_id) values ('Parity', 'parity', $1) returning id`,
    [owner],
  );
  workspaceId = ws.rows[0]!.id;

  await t.db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [workspaceId, member],
  );
});

afterAll(async () => {
  await t?.close();
});

describe("board access rules match between SQL and TypeScript", () => {
  it.each(scenarios)("$label", async (scenario) => {
    const actor = scenario.actor();

    // Arrange a board matching this scenario.
    await t.asAdmin();
    const board = await t.db.query<{ id: string }>(
      `insert into public.boards (workspace_id, name, owner_id, visibility, archived_at)
       values ($1, 'Parity board', $2, $3::public.board_visibility, $4)
       returning id`,
      [
        workspaceId,
        owner,
        scenario.visibility,
        scenario.archived ? new Date().toISOString() : null,
      ],
    );
    const boardId = board.rows[0]!.id;

    if (scenario.explicitRole) {
      await t.db.query(
        `insert into public.board_members (board_id, user_id, role) values ($1, $2, $3::public.board_role)`,
        [boardId, actor, scenario.explicitRole],
      );
    }

    // Ask the database.
    await t.asUser(actor);
    const sql = await t.db.query<{
      role: BoardRole | null;
      can_view: boolean;
      can_edit: boolean;
    }>(
      `select public.board_access_role($1) as role,
              public.can_view_board($1) as can_view,
              public.can_edit_board($1) as can_edit`,
      [boardId],
    );
    const fromSql = sql.rows[0]!;

    // Ask TypeScript.
    const ctx: BoardAccessContext = {
      userId: actor,
      ownerId: owner,
      visibility: scenario.visibility,
      archivedAt: scenario.archived ? new Date().toISOString() : null,
      explicitRole: scenario.explicitRole,
      isWorkspaceMember: scenario.isWorkspaceMember,
    };

    expect(resolveBoardRole(ctx), "effective role").toBe(fromSql.role);
    expect(canViewBoard(ctx), "view permission").toBe(fromSql.can_view);
    expect(canEditBoard(ctx), "edit permission").toBe(fromSql.can_edit);
  });
});
