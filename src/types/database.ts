/**
 * Typed shape of the `public` schema.
 *
 * Hand-maintained to match `supabase/migrations/`. Once a Supabase project is
 * linked, regenerate instead of editing by hand:
 *
 *     npx supabase gen types typescript --linked > src/types/database.ts
 *
 * Keeping this in sync is enforced indirectly: the RLS integration suite runs
 * the real migrations, so a column renamed there without updating this file
 * will surface as a type error at the first query that uses it.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type WorkspaceRole = "owner" | "admin" | "member";
export type BoardRole = "editor" | "viewer";
export type BoardVisibility = "private" | "workspace";

export type ActivityEventType =
  | "board.created"
  | "board.renamed"
  | "board.archived"
  | "board.restored"
  | "board.deleted"
  | "board.visibility_changed"
  | "board.shared"
  | "member.invited"
  | "member.joined"
  | "member.removed"
  | "member.role_changed"
  | "comment.created"
  | "comment.resolved";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
        };
        // Only these columns carry an UPDATE grant.
        Update: {
          display_name?: string;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          owner_id: string;
        };
        Update: {
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          joined_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: WorkspaceRole;
        };
        Update: {
          role?: WorkspaceRole;
        };
        Relationships: [];
      };
      boards: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          owner_id: string;
          visibility: BoardVisibility;
          /** Maintained by a trigger on board_share_links; not directly writable. */
          share_link_enabled: boolean;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          owner_id: string;
          visibility?: BoardVisibility;
          share_link_enabled?: boolean;
        };
        Update: {
          name?: string;
          visibility?: BoardVisibility;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      /**
       * Share-link tokens, in their own table.
       *
       * No grants for `anon` or `authenticated` and RLS enabled with no
       * policies — only the service role can touch it. Kept out of `boards`
       * because column-level grants there broke `count(*)`; see migration
       * 20260825000400.
       */
      board_share_links: {
        Row: {
          board_id: string;
          token_hash: string;
          created_at: string;
        };
        Insert: {
          board_id: string;
          token_hash: string;
        };
        Update: {
          token_hash?: string;
        };
        Relationships: [];
      };
      board_members: {
        Row: {
          board_id: string;
          user_id: string;
          role: BoardRole;
          created_at: string;
        };
        Insert: {
          board_id: string;
          user_id: string;
          role?: BoardRole;
        };
        Update: {
          role?: BoardRole;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          workspace_id: string;
          board_id: string | null;
          email: string;
          role: WorkspaceRole | BoardRole;
          token_hash: string;
          invited_by: string;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          board_id?: string | null;
          email: string;
          role: WorkspaceRole | BoardRole;
          token_hash: string;
          invited_by: string;
          expires_at: string;
        };
        // No UPDATE grant: acceptance runs server-side under the service role.
        Update: never;
        Relationships: [];
      };
      comments: {
        Row: {
          id: string;
          board_id: string;
          author_id: string;
          body: string;
          position_x: number | null;
          position_y: number | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          board_id: string;
          author_id: string;
          body: string;
          position_x?: number | null;
          position_y?: number | null;
        };
        Update: {
          body?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      activity_logs: {
        Row: {
          id: string;
          workspace_id: string;
          board_id: string | null;
          actor_id: string | null;
          event_type: ActivityEventType;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          board_id?: string | null;
          actor_id: string;
          event_type: ActivityEventType;
          metadata?: Json;
        };
        // Append-only: no UPDATE or DELETE grant exists.
        Update: never;
        Relationships: [];
      };
      board_snapshots: {
        Row: {
          id: string;
          board_id: string;
          version: number;
          snapshot: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          board_id: string;
          version: number;
          snapshot: Json;
        };
        // Snapshots are immutable.
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_workspace_member: { Args: { p_workspace_id: string }; Returns: boolean };
      workspace_role_of: { Args: { p_workspace_id: string }; Returns: WorkspaceRole | null };
      is_workspace_admin: { Args: { p_workspace_id: string }; Returns: boolean };
      board_access_role: { Args: { p_board_id: string }; Returns: BoardRole | null };
      can_view_board: { Args: { p_board_id: string }; Returns: boolean };
      can_edit_board: { Args: { p_board_id: string }; Returns: boolean };
      is_board_owner: { Args: { p_board_id: string }; Returns: boolean };
      shares_workspace_with: { Args: { p_user_id: string }; Returns: boolean };
      accept_invitation: {
        Args: { p_token_hash: string };
        Returns: { workspaceId: string; boardId: string | null; target: string };
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      board_role: BoardRole;
      board_visibility: BoardVisibility;
      activity_event_type: ActivityEventType;
    };
    CompositeTypes: Record<never, never>;
  };
};

/** Convenience aliases for row shapes. */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Profile = Tables<"profiles">;
export type Workspace = Tables<"workspaces">;
export type WorkspaceMember = Tables<"workspace_members">;
export type Board = Tables<"boards">;
export type BoardMember = Tables<"board_members">;
export type Invitation = Tables<"invitations">;
export type Comment = Tables<"comments">;
export type ActivityLog = Tables<"activity_logs">;
export type BoardSnapshot = Tables<"board_snapshots">;
