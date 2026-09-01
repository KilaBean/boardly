-- ============================================================================
-- Boardly — authorization helper functions
--
-- WHY SECURITY DEFINER:
-- A policy on workspace_members that itself queries workspace_members causes
-- "infinite recursion detected in policy". These helpers run as the function
-- owner, which bypasses RLS on the tables they read, so a policy can ask
-- "is this user a member?" without re-entering its own policy.
--
-- Every function is `set search_path = ''` and fully schema-qualified. Without
-- that, a caller could put a malicious schema ahead of `public` on the search
-- path and have a SECURITY DEFINER function execute their code as the owner.
--
-- `(select auth.uid())` is wrapped in a subquery on purpose: Postgres then
-- evaluates it once as an InitPlan instead of once per row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Workspace scope
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
  );
$fn$;

create or replace function public.workspace_role_of(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $fn$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = (select auth.uid());
$fn$;

create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    public.workspace_role_of(p_workspace_id) in ('owner', 'admin'),
    false
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Board scope
-- ---------------------------------------------------------------------------

-- Resolves the caller's effective role on a board, in strict precedence order:
--
--   1. Board owner                     -> editor
--   2. Explicit board_members row      -> that row's role
--   3. visibility = 'workspace'
--      and caller is a workspace member -> editor
--   4. otherwise                       -> null (no access)
--
-- Explicit board membership therefore OVERRIDES the workspace-wide default,
-- which is what makes "share this board with Sam as viewer only" meaningful
-- inside a workspace everyone else can edit.
--
-- Note this deliberately grants workspace admins NO access to a private board
-- they are not a member of. Least privilege beats administrative convenience;
-- see docs/adr/0002-authorization-model.md.
create or replace function public.board_access_role(p_board_id uuid)
returns public.board_role
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when b.owner_id = (select auth.uid()) then 'editor'::public.board_role
    when bm.role is not null then bm.role
    when b.visibility = 'workspace' and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = b.workspace_id
        and wm.user_id = (select auth.uid())
    ) then 'editor'::public.board_role
    else null
  end
  from public.boards b
  left join public.board_members bm
    on bm.board_id = b.id
   and bm.user_id = (select auth.uid())
  where b.id = p_board_id;
$fn$;

create or replace function public.can_view_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.board_access_role(p_board_id) is not null;
$fn$;

-- Content edit rights. An archived board is read-only, so this returns false
-- for it. Un-archiving is an UPDATE on `boards` itself, governed by
-- is_board_owner, so a board can always be brought back.
--
-- The coalesce is load-bearing: board_access_role() returns NULL for "no
-- access", and `NULL = 'editor'` is NULL, not false. RLS happens to treat a
-- NULL predicate as deny, but a boolean helper that can return NULL is a trap
-- for any caller that negates it — `not null` is null, which would read as
-- "not denied". Always resolve to a real boolean.
create or replace function public.can_edit_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    public.board_access_role(p_board_id) = 'editor'
      and exists (
        select 1
        from public.boards b
        where b.id = p_board_id
          and b.archived_at is null
      ),
    false
  );
$fn$;

create or replace function public.is_board_owner(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.boards b
    where b.id = p_board_id
      and b.owner_id = (select auth.uid())
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Profile visibility
-- ---------------------------------------------------------------------------

-- Prevents enumerating every user of the platform: you can only resolve the
-- profile of somebody you actually share a workspace with.
create or replace function public.shares_workspace_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs
      on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Execution grants
--
-- These functions run with owner privileges, so PUBLIC must not keep the
-- default EXECUTE grant.
-- ---------------------------------------------------------------------------

revoke execute on function public.is_workspace_member(uuid) from public;
revoke execute on function public.workspace_role_of(uuid) from public;
revoke execute on function public.is_workspace_admin(uuid) from public;
revoke execute on function public.board_access_role(uuid) from public;
revoke execute on function public.can_view_board(uuid) from public;
revoke execute on function public.can_edit_board(uuid) from public;
revoke execute on function public.is_board_owner(uuid) from public;
revoke execute on function public.shares_workspace_with(uuid) from public;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.workspace_role_of(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.board_access_role(uuid) to authenticated;
grant execute on function public.can_view_board(uuid) to authenticated;
grant execute on function public.can_edit_board(uuid) to authenticated;
grant execute on function public.is_board_owner(uuid) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;
