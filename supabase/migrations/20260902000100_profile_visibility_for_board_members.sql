-- ---------------------------------------------------------------------------
-- Profile visibility for people who share a board
--
-- `profiles_select` allowed reading a profile only when the two users shared a
-- workspace. But a board invitation grants board membership and deliberately
-- not workspace membership, so an invited collaborator and the board owner
-- could work together all day without being permitted to read each other's
-- display name.
--
-- Reported from production as the activity feed saying "Someone". The canvas
-- showed the right name throughout, because presence travels over Yjs
-- awareness — client to client, never through Postgres — which is exactly why
-- only the database-backed names were wrong.
--
-- It was not only a wrong label. `listBoardMembers` and the comments query
-- both join `profiles!inner`, and an unreadable profile removes the row
-- altogether: the collaborator disappeared from "People with access" and their
-- comments vanished from the panel.
-- ---------------------------------------------------------------------------

-- Boards a user can reach directly: ones they own, plus ones they are a member
-- of. Workspace-visible boards are deliberately excluded — that relationship is
-- already covered by shares_workspace_with, and folding it in here would make
-- every workspace member's profile visible twice over for no gain.
create or replace function public.shares_board_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  with mine as (
    select b.id from public.boards b where b.owner_id = (select auth.uid())
    union
    select bm.board_id from public.board_members bm where bm.user_id = (select auth.uid())
  ),
  theirs as (
    select b.id from public.boards b where b.owner_id = p_user_id
    union
    select bm.board_id from public.board_members bm where bm.user_id = p_user_id
  )
  select exists (select 1 from mine join theirs on theirs.id = mine.id);
$fn$;

comment on function public.shares_board_with(uuid) is
  'True when the current user and p_user_id both own or belong to the same board.';

-- Same posture as the other helpers: not callable by anon, and never by the
-- public role.
revoke execute on function public.shares_board_with(uuid) from public;
grant execute on function public.shares_board_with(uuid) to authenticated;

-- A profile is a display name and an avatar. It carries no email and no
-- credential, so showing it to someone you are actively sharing a board with
-- reveals nothing they cannot already see on the canvas.
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.shares_workspace_with(id)
    or public.shares_board_with(id)
  );
