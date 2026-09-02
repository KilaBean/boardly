-- ============================================================================
-- Boardly — share links carry an access level
--
-- Share links were view-only with no alternative. The owner now chooses, when
-- creating the link, whether it grants viewing or editing.
--
-- An edit link does NOT hand write access to an anonymous visitor. It is
-- redeemed by a signed-in user, which turns it into ordinary board
-- membership — so every edit is attributable, appears in the activity trail,
-- and one person can be removed without revoking the link for everybody. A
-- view link is unchanged: still anonymous, still a snapshot, still no room.
-- ============================================================================

alter table public.board_share_links
  add column role public.board_role not null default 'viewer';

-- Mirrored onto `boards` for the same reason `share_link_enabled` is: the
-- board page needs it on every load, `board_share_links` carries no grant for
-- `authenticated`, and reading it through the admin client on every render
-- would be a second round trip to learn something that is not secret.
--
-- Null when there is no link, so the two columns cannot disagree.
alter table public.boards
  add column share_link_role public.board_role;

-- ---------------------------------------------------------------------------
-- Keep the mirrored columns truthful.
--
-- Extends the existing trigger rather than adding a second one, so the flag
-- and the role are always written in the same statement and can never drift
-- apart.
-- ---------------------------------------------------------------------------
create or replace function public.sync_board_share_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    update public.boards
      set share_link_enabled = false,
          share_link_role = null
      where id = old.board_id;
    return old;
  end if;

  update public.boards
    set share_link_enabled = true,
        share_link_role = new.role
    where id = new.board_id;
  return new;
end;
$fn$;

-- Existing links keep the behaviour they already had.
update public.boards b
  set share_link_role = l.role
  from public.board_share_links l
  where l.board_id = b.id;

-- `share_link_role` is deliberately absent from the UPDATE grant, exactly like
-- `share_link_enabled`: both are maintained solely by the trigger, so a client
-- cannot claim a link grants editing when it does not.
revoke update on public.boards from authenticated;
grant update (name, visibility, archived_at) on public.boards to authenticated;

-- ---------------------------------------------------------------------------
-- Redeeming an edit link
--
-- Deliberately a function rather than something the share page does on GET:
-- it mutates membership, so it must be an explicit action, and it must run
-- with the caller's identity rather than the admin client.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_share_link(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := (select auth.uid());
  v_link record;
begin
  if v_user is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege';
  end if;

  select l.board_id,
         l.role,
         b.workspace_id,
         b.owner_id,
         b.archived_at,
         b.share_link_enabled
    into v_link
    from public.board_share_links l
    join public.boards b on b.id = l.board_id
   where l.token_hash = p_token_hash;

  -- One message for "no such token", "view-only link", "revoked" and
  -- "archived". A caller holding a bad token learns only that it does not
  -- work, never why.
  if not found
     or v_link.role <> 'editor'
     or not v_link.share_link_enabled
     or v_link.archived_at is not null then
    raise exception 'This link cannot be used to edit this board'
      using errcode = 'no_data_found';
  end if;

  -- The owner already has full rights; adding a membership row would be noise
  -- in the members list.
  if v_link.owner_id <> v_user then
    insert into public.board_members (board_id, user_id, role)
    values (v_link.board_id, v_user, 'editor')
    on conflict (board_id, user_id) do update set role = 'editor';

    insert into public.activity_logs (workspace_id, board_id, actor_id, event_type, metadata)
    values (
      v_link.workspace_id,
      v_link.board_id,
      v_user,
      'member.joined',
      jsonb_build_object('role', 'editor', 'via', 'share_link')
    );
  end if;

  return jsonb_build_object('boardId', v_link.board_id);
end;
$fn$;

revoke execute on function public.redeem_share_link(text) from public;
grant execute on function public.redeem_share_link(text) to authenticated;
