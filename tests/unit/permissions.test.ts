import { describe, expect, it } from "vitest";

import {
  canAssignWorkspaceRole,
  canComment,
  canDeleteWorkspace,
  canEditBoard,
  canEditCommentBody,
  canManageBoard,
  canRemoveWorkspaceMember,
  canResolveComment,
  canViewBoard,
  isWorkspaceAdmin,
  resolveBoardRole,
  type BoardAccessContext,
} from "@/lib/permissions";

const ALICE = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const BOB = "3a7b8c9d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";

function ctx(overrides: Partial<BoardAccessContext> = {}): BoardAccessContext {
  return {
    userId: BOB,
    ownerId: ALICE,
    visibility: "workspace",
    archivedAt: null,
    explicitRole: null,
    isWorkspaceMember: true,
    ...overrides,
  };
}

describe("resolveBoardRole precedence", () => {
  it("gives the board owner editor rights", () => {
    expect(resolveBoardRole(ctx({ userId: ALICE }))).toBe("editor");
  });

  it("lets the owner edit even a private board they are not a member of", () => {
    expect(
      resolveBoardRole(ctx({ userId: ALICE, visibility: "private", isWorkspaceMember: false })),
    ).toBe("editor");
  });

  it("gives workspace members editor rights on a workspace-visible board", () => {
    expect(resolveBoardRole(ctx())).toBe("editor");
  });

  it("lets an explicit viewer grant override the workspace default", () => {
    // The whole point of per-board sharing: read-only for one person inside a
    // workspace everyone else can edit.
    expect(resolveBoardRole(ctx({ explicitRole: "viewer" }))).toBe("viewer");
  });

  it("lets an explicit editor grant open a private board", () => {
    expect(resolveBoardRole(ctx({ visibility: "private", explicitRole: "editor" }))).toBe("editor");
  });

  it("denies a workspace member access to a private board", () => {
    expect(resolveBoardRole(ctx({ visibility: "private" }))).toBeNull();
  });

  it("denies a non-member access to a workspace-visible board", () => {
    expect(resolveBoardRole(ctx({ isWorkspaceMember: false }))).toBeNull();
  });
});

describe("board capabilities", () => {
  it("treats an archived board as read-only for everyone, including the owner", () => {
    const archived = ctx({ userId: ALICE, archivedAt: "2026-01-01T00:00:00Z" });
    expect(canViewBoard(archived)).toBe(true);
    expect(canEditBoard(archived)).toBe(false);
  });

  it("still lets the owner manage an archived board so it can be restored", () => {
    expect(canManageBoard(ctx({ userId: ALICE, archivedAt: "2026-01-01T00:00:00Z" }))).toBe(true);
  });

  it("does not let a non-owner editor manage the board", () => {
    expect(canEditBoard(ctx())).toBe(true);
    expect(canManageBoard(ctx())).toBe(false);
  });

  it("lets a viewer comment but not edit", () => {
    const viewer = ctx({ explicitRole: "viewer" });
    expect(canComment(viewer)).toBe(true);
    expect(canEditBoard(viewer)).toBe(false);
  });

  it("restricts comment body edits to the author while letting editors resolve", () => {
    const editor = ctx();
    expect(canEditCommentBody(editor, ALICE)).toBe(false);
    expect(canResolveComment(editor, ALICE)).toBe(true);
    expect(canEditCommentBody(editor, BOB)).toBe(true);
  });
});

describe("workspace roles", () => {
  it("treats owner and admin as administrators", () => {
    expect(isWorkspaceAdmin("owner")).toBe(true);
    expect(isWorkspaceAdmin("admin")).toBe(true);
    expect(isWorkspaceAdmin("member")).toBe(false);
    expect(isWorkspaceAdmin(null)).toBe(false);
  });

  it("restricts workspace deletion to the owner", () => {
    expect(canDeleteWorkspace("owner")).toBe(true);
    expect(canDeleteWorkspace("admin")).toBe(false);
  });

  it("never allows granting ownership through role assignment", () => {
    expect(canAssignWorkspaceRole("owner", "member", "owner")).toBe(false);
    expect(canAssignWorkspaceRole("admin", "member", "owner")).toBe(false);
  });

  it("never allows changing the owner's role", () => {
    expect(canAssignWorkspaceRole("admin", "owner", "member")).toBe(false);
  });

  it("allows an admin to promote a member to admin", () => {
    expect(canAssignWorkspaceRole("admin", "member", "admin")).toBe(true);
  });

  it("lets a member remove themselves but not others", () => {
    expect(canRemoveWorkspaceMember("member", "member", true)).toBe(true);
    expect(canRemoveWorkspaceMember("member", "member", false)).toBe(false);
  });

  it("never allows removing the workspace owner", () => {
    expect(canRemoveWorkspaceMember("admin", "owner", false)).toBe(false);
    expect(canRemoveWorkspaceMember("owner", "owner", true)).toBe(false);
  });
});
