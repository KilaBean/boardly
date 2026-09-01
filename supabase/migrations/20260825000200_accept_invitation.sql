-- ============================================================================
-- Boardly — invitation acceptance
--
-- Accepting an invitation is two writes that must not come apart: create the
-- membership, and mark the invitation used. Doing them as two PostgREST calls
-- leaves a window where a crash between them either grants access to a
-- still-unused invitation, or burns an invitation that granted nothing.
--
-- A function is one transaction, so the pair is atomic.
--
-- SECURITY DEFINER because the invitee, by definition, does not yet have
-- permission to insert their own membership row — that is the whole point of
-- being invited. The function therefore does the authorization itself, and is
-- deliberately strict about it.
-- ============================================================================

-- Returns jsonb rather than a table: with RETURNS TABLE, the output column
-- names become PL/pgSQL variables that collide with the identically-named
-- columns in the INSERT statements below ("column reference is ambiguous").
create or replace function public.accept_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_invite public.invitations%rowtype;
  v_user uuid := (select auth.uid());
  v_email text;
begin
  if v_user is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE serializes concurrent acceptances of the same invitation, so a
  -- link opened twice at once cannot be consumed twice.
  select * into v_invite
  from public.invitations i
  where i.token_hash = p_token_hash
    and i.accepted_at is null
    and i.expires_at > now()
  for update;

  if not found then
    -- One message for "no such token", "already used" and "expired". A caller
    -- holding a bad token learns only that it does not work, never why.
    raise exception 'Invitation is invalid or has expired'
      using errcode = 'no_data_found';
  end if;

  -- An invitation is addressed to a person, not to whoever holds the link.
  -- Without this check, a forwarded invitation would let anyone join.
  select lower(coalesce(u.email, '')) into v_email
  from auth.users u
  where u.id = v_user;

  if v_email is distinct from v_invite.email then
    raise exception 'This invitation was sent to a different email address'
      using errcode = 'insufficient_privilege';
  end if;

  if v_invite.board_id is null then
    -- Workspace invitation. `do nothing` on conflict: already being a member
    -- is success, not an error, and must never silently downgrade an existing
    -- role (an owner accepting a stale 'member' invite keeps ownership).
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_invite.workspace_id, v_user, v_invite.role::public.workspace_role)
    on conflict (workspace_id, user_id) do nothing;
  else
    -- Board invitation. Re-inviting with a different role is a deliberate
    -- change, so this one does update.
    insert into public.board_members (board_id, user_id, role)
    values (v_invite.board_id, v_user, v_invite.role::public.board_role)
    on conflict (board_id, user_id) do update set role = excluded.role;
  end if;

  update public.invitations
  set accepted_at = now()
  where id = v_invite.id;

  insert into public.activity_logs (workspace_id, board_id, actor_id, event_type, metadata)
  values (
    v_invite.workspace_id,
    v_invite.board_id,
    v_user,
    'member.joined',
    jsonb_build_object('role', v_invite.role)
  );

  return jsonb_build_object(
    'workspaceId', v_invite.workspace_id,
    'boardId', v_invite.board_id,
    'target', case when v_invite.board_id is null then 'workspace' else 'board' end
  );
end;
$fn$;

revoke execute on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
