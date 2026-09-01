-- ============================================================================
-- Boardly — Row Level Security
--
-- Two independent layers guard every table:
--
--   1. GRANTs decide WHICH COLUMNS a role may touch at all. UPDATE is granted
--      column-by-column, so `owner_id`, `created_at` and `token_hash` are not
--      writable through the API by anyone — a workspace admin cannot make
--      themselves the owner with a crafted PATCH, because no policy is even
--      consulted for a column that was never granted.
--
--   2. POLICIES decide WHICH ROWS are visible or writable.
--
-- `anon` receives nothing. Public link sharing (Phase 5) will be served by a
-- server-side route that validates a token, not by relaxing these policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Start from zero privileges, then grant back deliberately.
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated;
revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.boards from anon, authenticated;
revoke all on public.board_members from anon, authenticated;
revoke all on public.invitations from anon, authenticated;
revoke all on public.comments from anon, authenticated;
revoke all on public.activity_logs from anon, authenticated;
revoke all on public.board_snapshots from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.invitations enable row level security;
alter table public.comments enable row level security;
alter table public.activity_logs enable row level security;
alter table public.board_snapshots enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

grant select, insert on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_workspace_with(id));

-- Fallback only: the on_auth_user_created trigger normally creates this row.
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.workspaces to authenticated;
grant update (name, slug) on public.workspaces to authenticated;

-- owner_id is checked directly as well as via membership so that INSERT
-- ... RETURNING succeeds before the ownership trigger's row is observable.
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_workspace_member(id));

create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (public.workspace_role_of(id) = 'owner');

-- ---------------------------------------------------------------------------
-- workspace_members
--
-- The `role <> 'owner'` clauses appear on both USING and WITH CHECK. USING
-- stops an admin from editing or removing the owner's row; WITH CHECK stops
-- them from promoting anybody (including themselves) to owner. Ownership
-- transfer is a server-side operation.
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.workspace_members to authenticated;
grant update (role) on public.workspace_members to authenticated;

create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy workspace_members_insert on public.workspace_members
  for insert to authenticated
  with check (public.is_workspace_admin(workspace_id) and role <> 'owner');

create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using (public.is_workspace_admin(workspace_id) and role <> 'owner')
  with check (public.is_workspace_admin(workspace_id) and role <> 'owner');

-- Admins may remove members; anybody may remove themselves. The owner's row
-- is immovable until ownership is transferred.
create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (
    role <> 'owner'
    and (
      public.is_workspace_admin(workspace_id)
      or user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- boards
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.boards to authenticated;
grant update (name, visibility, share_link_enabled, archived_at)
  on public.boards to authenticated;

create policy boards_select on public.boards
  for select to authenticated
  using (public.can_view_board(id));

create policy boards_insert on public.boards
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and owner_id = (select auth.uid())
  );

create policy boards_update on public.boards
  for update to authenticated
  using (public.is_board_owner(id))
  with check (public.is_board_owner(id));

create policy boards_delete on public.boards
  for delete to authenticated
  using (public.is_board_owner(id));

-- ---------------------------------------------------------------------------
-- board_members
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.board_members to authenticated;
grant update (role) on public.board_members to authenticated;

create policy board_members_select on public.board_members
  for select to authenticated
  using (public.can_view_board(board_id));

create policy board_members_insert on public.board_members
  for insert to authenticated
  with check (public.is_board_owner(board_id));

create policy board_members_update on public.board_members
  for update to authenticated
  using (public.is_board_owner(board_id))
  with check (public.is_board_owner(board_id));

create policy board_members_delete on public.board_members
  for delete to authenticated
  using (public.is_board_owner(board_id) or user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- invitations
--
-- No UPDATE grant at all. Accepting an invitation flips `accepted_at` and
-- creates a membership row atomically; that runs server-side under the
-- service role after verifying the token hash, so the invitee never needs
-- write access to this table.
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.invitations to authenticated;

create policy invitations_select on public.invitations
  for select to authenticated
  using (
    case
      when board_id is null then public.is_workspace_admin(workspace_id)
      else public.is_board_owner(board_id)
    end
  );

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and case
      when board_id is null then public.is_workspace_admin(workspace_id)
      else public.is_board_owner(board_id)
    end
  );

create policy invitations_delete on public.invitations
  for delete to authenticated
  using (
    case
      when board_id is null then public.is_workspace_admin(workspace_id)
      else public.is_board_owner(board_id)
    end
  );

-- ---------------------------------------------------------------------------
-- comments
--
-- Viewers may comment: a comment is discussion about the board, not board
-- content, and "viewers cannot modify board content" is preserved.
-- Body edits are further restricted to the author by the
-- comments_enforce_body_author trigger.
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.comments to authenticated;
grant update (body, resolved_at) on public.comments to authenticated;

create policy comments_select on public.comments
  for select to authenticated
  using (public.can_view_board(board_id));

create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_view_board(board_id)
  );

create policy comments_update on public.comments
  for update to authenticated
  using (author_id = (select auth.uid()) or public.can_edit_board(board_id))
  with check (author_id = (select auth.uid()) or public.can_edit_board(board_id));

create policy comments_delete on public.comments
  for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_board_owner(board_id));

-- ---------------------------------------------------------------------------
-- activity_logs
--
-- Append-only by construction: UPDATE and DELETE are never granted, so no
-- policy can accidentally re-open them. `actor_id = auth.uid()` stops a user
-- forging history in someone else's name.
-- ---------------------------------------------------------------------------

grant select, insert on public.activity_logs to authenticated;

create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (board_id is null or public.can_view_board(board_id))
  );

create policy activity_logs_insert on public.activity_logs
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and public.is_workspace_member(workspace_id)
    and (board_id is null or public.can_view_board(board_id))
  );

-- ---------------------------------------------------------------------------
-- board_snapshots
--
-- Immutable versions: no UPDATE grant. Pruning old snapshots is a delete by
-- the board owner.
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.board_snapshots to authenticated;

create policy board_snapshots_select on public.board_snapshots
  for select to authenticated
  using (public.can_view_board(board_id));

create policy board_snapshots_insert on public.board_snapshots
  for insert to authenticated
  with check (public.can_edit_board(board_id));

create policy board_snapshots_delete on public.board_snapshots
  for delete to authenticated
  using (public.is_board_owner(board_id));
