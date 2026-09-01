-- ============================================================================
-- Boardly — move share tokens out of `boards`
--
-- WHY THIS EXISTS
--
-- Migration 20260825000100 hid `boards.share_token_hash` by replacing the
-- table-level SELECT grant with column-level grants. That works for plain
-- column reads, but Postgres requires **table-level** SELECT for `count(*)` —
-- so `listWorkspaces()`, which embeds `boards(count)` to show a board tally,
-- began failing with:
--
--     permission denied for table boards
--
-- The application swallowed the error and returned an empty list, so every
-- signed-in user was redirected to onboarding as though they had no
-- workspaces. Found by running the E2E suite against a real Supabase stack;
-- PGlite never exercised it because the integration tests query as the
-- superuser or as `authenticated` with explicit column lists.
--
-- Column grants on a table this heavily queried are inherently fragile — they
-- also break `select *` and any future aggregate. Putting the secret in its
-- own table removes the whole class of problem: `boards` goes back to an
-- ordinary table-level grant governed by RLS, and the token lives somewhere
-- no API role can reach at all.
-- ============================================================================

create table public.board_share_links (
  board_id uuid primary key references public.boards (id) on delete cascade,
  token_hash text not null unique
    constraint board_share_links_token_hash_length
      check (char_length(token_hash) between 32 and 128),
  created_at timestamptz not null default now()
);

-- RLS on with no policies at all: even if a grant were added by mistake,
-- `authenticated` would still match no rows.
alter table public.board_share_links enable row level security;

revoke all on public.board_share_links from anon, authenticated;
grant select, insert, update, delete on public.board_share_links to service_role;

-- ---------------------------------------------------------------------------
-- Keep boards.share_link_enabled truthful.
--
-- The old CHECK constraint ("enabled implies a token") cannot span two tables,
-- so a trigger maintains the flag instead. Sharing is therefore enabled by
-- creating a link and disabled by deleting one — the flag can never drift out
-- of step with reality, which is what the constraint was protecting.
-- ---------------------------------------------------------------------------

create or replace function public.sync_board_share_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    update public.boards set share_link_enabled = false where id = old.board_id;
    return old;
  end if;

  update public.boards set share_link_enabled = true where id = new.board_id;
  return new;
end;
$fn$;

create trigger board_share_links_sync_flag
  after insert or update or delete on public.board_share_links
  for each row execute function public.sync_board_share_flag();

-- ---------------------------------------------------------------------------
-- Carry over any existing links, then retire the column.
-- ---------------------------------------------------------------------------

insert into public.board_share_links (board_id, token_hash)
select id, share_token_hash
from public.boards
where share_token_hash is not null
on conflict (board_id) do nothing;

alter table public.boards drop constraint boards_share_link_requires_token;
drop index if exists public.boards_share_token_hash_idx;
alter table public.boards drop column share_token_hash;

-- ---------------------------------------------------------------------------
-- Restore ordinary grants on boards.
--
-- Dropping the column also drops its column-level grants, so SELECT is granted
-- at table level again — RLS still decides which rows are visible.
--
-- `share_link_enabled` is deliberately absent from the UPDATE grant: it is now
-- maintained solely by the trigger above, so a client cannot claim a board is
-- shared when no link exists.
-- ---------------------------------------------------------------------------

grant select on public.boards to authenticated;

revoke update on public.boards from authenticated;
grant update (name, visibility, archived_at) on public.boards to authenticated;
