import { describe, expect, it } from "vitest";

import {
  createBoardSchema,
  createCommentSchema,
  createInvitationSchema,
  createWorkspaceSchema,
  emailSchema,
  slugSchema,
  updateWorkspaceMemberRoleSchema,
} from "@/lib/validation/schemas";

describe("slugSchema", () => {
  it.each(["acme", "acme-corp", "a1", "team-42-x"])("accepts %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    ["A", "too short"],
    ["Acme", "uppercase"],
    ["-acme", "leading hyphen"],
    ["acme-", "trailing hyphen"],
    ["acme--corp", "double hyphen"],
    ["acme corp", "space"],
    ["acme_corp", "underscore"],
  ])("rejects %s (%s)", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });
});

describe("emailSchema", () => {
  it("normalizes to lowercase and trims, matching the SQL CHECK", () => {
    // invitations_email_normalized requires email = lower(btrim(email)).
    const result = emailSchema.safeParse("  Alice@Example.COM  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("alice@example.com");
  });

  it("rejects an address with no domain", () => {
    expect(emailSchema.safeParse("alice@").success).toBe(false);
  });
});

describe("createWorkspaceSchema", () => {
  it("accepts a valid workspace", () => {
    expect(createWorkspaceSchema.safeParse({ name: "Acme", slug: "acme" }).success).toBe(true);
  });

  it("rejects a whitespace-only name", () => {
    expect(createWorkspaceSchema.safeParse({ name: "   ", slug: "acme" }).success).toBe(false);
  });
});

describe("createBoardSchema", () => {
  it("defaults visibility to workspace", () => {
    const result = createBoardSchema.safeParse({
      workspaceId: "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f",
      name: "Roadmap",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.visibility).toBe("workspace");
  });

  it("rejects a non-uuid workspace id", () => {
    // Board and workspace ids arrive as untrusted strings.
    expect(
      createBoardSchema.safeParse({ workspaceId: "'; drop table boards;--", name: "x" }).success,
    ).toBe(false);
  });
});

describe("createCommentSchema", () => {
  const boardId = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

  it("accepts an unanchored comment", () => {
    const result = createCommentSchema.safeParse({ boardId, body: "Nice" });
    expect(result.success).toBe(true);
  });

  it("accepts a fully anchored comment", () => {
    const result = createCommentSchema.safeParse({
      boardId,
      body: "Here",
      positionX: 10,
      positionY: 20,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a half-placed pin, matching comments_position_complete", () => {
    const result = createCommentSchema.safeParse({ boardId, body: "Here", positionX: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-finite coordinate", () => {
    const result = createCommentSchema.safeParse({
      boardId,
      body: "Here",
      positionX: Number.POSITIVE_INFINITY,
      positionY: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("createInvitationSchema", () => {
  const workspaceId = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
  const boardId = "3a7b8c9d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";

  it("accepts a workspace invitation with a workspace role", () => {
    const result = createInvitationSchema.safeParse({
      target: "workspace",
      workspaceId,
      email: "a@b.com",
      role: "member",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a board invitation with a board role", () => {
    const result = createInvitationSchema.safeParse({
      target: "board",
      workspaceId,
      boardId,
      email: "a@b.com",
      role: "viewer",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a workspace invitation carrying a board role", () => {
    // Mirrors invitations_role_matches_target; the union makes the
    // mismatched pairing unrepresentable.
    const result = createInvitationSchema.safeParse({
      target: "workspace",
      workspaceId,
      email: "a@b.com",
      role: "editor",
    });
    expect(result.success).toBe(false);
  });

  it("never allows inviting somebody straight to owner", () => {
    const result = createInvitationSchema.safeParse({
      target: "workspace",
      workspaceId,
      email: "a@b.com",
      role: "owner",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateWorkspaceMemberRoleSchema", () => {
  it("refuses to assign the owner role", () => {
    const result = updateWorkspaceMemberRoleSchema.safeParse({
      workspaceId: "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f",
      userId: "3a7b8c9d-1e2f-4a3b-9c4d-5e6f7a8b9c0d",
      role: "owner",
    });
    expect(result.success).toBe(false);
  });
});
