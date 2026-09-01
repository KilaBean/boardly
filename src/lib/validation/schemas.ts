import { z } from "zod";

/**
 * Runtime schemas for user-supplied input.
 *
 * IDs arriving from a client are untrusted strings until parsed here. Every
 * server action and route handler should parse its input through one of these
 * before touching the database — a malformed uuid should be rejected at the
 * edge, not turned into a database error.
 *
 * These mirror the CHECK constraints in the migrations. The database remains
 * the authority; this layer exists to produce good error messages and to fail
 * fast.
 */

export const uuidSchema = z.uuid({ message: "Must be a valid identifier" });

export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);
export const boardRoleSchema = z.enum(["editor", "viewer"]);
export const boardVisibilitySchema = z.enum(["private", "workspace"]);

/** Roles that may actually be granted through the API. Owner is excluded. */
export const assignableWorkspaceRoleSchema = z.enum(["admin", "member"]);

// Normalize BEFORE validating. The other order rejects "  A@B.com  " outright
// instead of accepting it as "a@b.com", and the stored value must already
// satisfy the invitations_email_normalized CHECK (email = lower(btrim(email))).
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address" }).max(320));

// Matches workspaces_slug_format / workspaces_slug_length in SQL.
export const slugSchema = z
  .string()
  .min(2, "Slug must be at least 2 characters")
  .max(48, "Slug must be at most 48 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name must be at most 80 characters");

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(80),
  slug: slugSchema,
});

export const updateWorkspaceSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string().trim().min(1).max(80).optional(),
  slug: slugSchema.optional(),
});

export const updateWorkspaceMemberRoleSchema = z.object({
  workspaceId: uuidSchema,
  userId: uuidSchema,
  role: assignableWorkspaceRoleSchema,
});

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export const boardNameSchema = z
  .string()
  .trim()
  .min(1, "Board name is required")
  .max(120, "Board name must be at most 120 characters");

export const createBoardSchema = z.object({
  workspaceId: uuidSchema,
  name: boardNameSchema,
  visibility: boardVisibilitySchema.default("workspace"),
});

export const updateBoardSchema = z.object({
  boardId: uuidSchema,
  name: boardNameSchema.optional(),
  visibility: boardVisibilitySchema.optional(),
  // Sharing is toggled by creating or deleting a share link, never by writing
  // this flag directly — see migration 20260825000400.
});

export const setBoardMemberSchema = z.object({
  boardId: uuidSchema,
  userId: uuidSchema,
  role: boardRoleSchema,
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const createCommentSchema = z
  .object({
    boardId: uuidSchema,
    body: z.string().trim().min(1, "Comment cannot be empty").max(4000),
    positionX: z.number().finite().nullable().default(null),
    positionY: z.number().finite().nullable().default(null),
  })
  // Mirrors the comments_position_complete CHECK: a pin is placed or it isn't.
  .refine((v) => (v.positionX === null) === (v.positionY === null), {
    message: "A comment pin needs both coordinates or neither",
    path: ["positionX"],
  });

export const resolveCommentSchema = z.object({
  commentId: uuidSchema,
  resolved: z.boolean(),
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * A workspace invitation carries a workspace role; a board invitation carries
 * a board role. Modelled as a discriminated union so an impossible pairing is
 * unrepresentable, matching invitations_role_matches_target in SQL.
 */
export const createInvitationSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("workspace"),
    workspaceId: uuidSchema,
    email: emailSchema,
    role: assignableWorkspaceRoleSchema,
  }),
  z.object({
    target: z.literal("board"),
    workspaceId: uuidSchema,
    boardId: uuidSchema,
    email: emailSchema,
    role: boardRoleSchema,
  }),
]);

export const acceptInvitationSchema = z.object({
  token: z.string().min(20, "Invalid invitation token").max(200),
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  avatarUrl: z.url().max(2048).nullable().optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
