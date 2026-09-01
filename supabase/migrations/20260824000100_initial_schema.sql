-- ============================================================================
-- Boardly — initial schema
--
-- Durable relational data only. Live canvas operations and cursor movement
-- belong to Liveblocks and never reach this database; `board_snapshots` holds
-- periodic checkpoints for recovery, not an operation log.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.workspace_role as enum ('owner', 'admin', 'member');

-- Board ownership lives in boards.owner_id, so it is not repeated here.
create type public.board_role as enum ('editor', 'viewer');

create type public.board_visibility as enum ('private', 'workspace');

create type public.activity_event_type as enum (
  'board.created',
  'board.renamed',
  'board.archived',
  'board.restored',
  'board.deleted',
  'board.visibility_changed',
  'board.shared',
  'member.invited',
  'member.joined',
  'member.removed',
  'member.role_changed',
  'comment.created',
  'comment.resolved'
);

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- profiles
--
-- One row per auth user. Created automatically by a trigger on auth.users so
-- that application code never has to cope with a missing profile.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    constraint profiles_display_name_length check (char_length(display_name) between 1 and 80),
  avatar_url text
    constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- workspaces
--
-- owner_id uses ON DELETE RESTRICT: deleting a user must not silently destroy
-- a team's workspace. Ownership has to be transferred first.
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint workspaces_name_length check (char_length(btrim(name)) between 1 and 80),
  slug text not null unique
    constraint workspaces_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    constraint workspaces_slug_length check (char_length(slug) between 2 and 48),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_id_idx on public.workspaces (owner_id);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- Exactly one owner per workspace.
create unique index workspace_members_single_owner_idx
  on public.workspace_members (workspace_id)
  where role = 'owner';

-- ---------------------------------------------------------------------------
-- boards
-- ---------------------------------------------------------------------------

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null
    constraint boards_name_length check (char_length(btrim(name)) between 1 and 120),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  visibility public.board_visibility not null default 'workspace',
  share_link_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index boards_workspace_id_idx on public.boards (workspace_id);
create index boards_owner_id_idx on public.boards (owner_id);

-- Drives the dashboard "recent boards" query.
create index boards_workspace_recent_idx
  on public.boards (workspace_id, updated_at desc)
  where archived_at is null;

create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- board_members
--
-- An explicit grant on a single board. Overrides the workspace-wide default.
-- ---------------------------------------------------------------------------

create table public.board_members (
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.board_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create index board_members_user_id_idx on public.board_members (user_id);

-- ---------------------------------------------------------------------------
-- invitations
--
-- Only a HASH of the invitation token is stored. The raw token exists solely
-- in the emailed link, so a database leak cannot be replayed into access.
-- ---------------------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  board_id uuid references public.boards (id) on delete cascade,
  email text not null
    constraint invitations_email_normalized check (email = lower(btrim(email)))
    constraint invitations_email_shape check (
      char_length(email) between 3 and 320 and position('@' in email) > 1
    ),
  role text not null,
  token_hash text not null unique
    constraint invitations_token_hash_length check (char_length(token_hash) between 32 and 128),
  invited_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  -- A workspace invitation carries a workspace role; a board invitation
  -- carries a board role. The target decides which vocabulary is legal.
  constraint invitations_role_matches_target check (
    (board_id is null and role in ('admin', 'member'))
    or (board_id is not null and role in ('editor', 'viewer'))
  ),
  constraint invitations_expires_after_creation check (expires_at > created_at)
);

create index invitations_workspace_id_idx on public.invitations (workspace_id);
create index invitations_board_id_idx on public.invitations (board_id) where board_id is not null;
create index invitations_email_idx on public.invitations (email);

-- At most one outstanding invitation per (target, email).
create unique index invitations_unique_pending_idx
  on public.invitations (
    workspace_id,
    coalesce(board_id, '00000000-0000-0000-0000-000000000000'::uuid),
    email
  )
  where accepted_at is null;

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null
    constraint comments_body_length check (char_length(btrim(body)) between 1 and 4000),
  position_x double precision,
  position_y double precision,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A pin is either fully placed or not placed at all.
  constraint comments_position_complete check ((position_x is null) = (position_y is null))
);

create index comments_board_created_idx on public.comments (board_id, created_at desc);

create index comments_board_unresolved_idx
  on public.comments (board_id)
  where resolved_at is null;

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activity_logs
--
-- Append-only. actor_id is nullable ON DELETE SET NULL so the audit trail
-- survives account deletion.
-- ---------------------------------------------------------------------------

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  board_id uuid references public.boards (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type public.activity_event_type not null,
  metadata jsonb not null default '{}'::jsonb
    constraint activity_logs_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index activity_logs_workspace_created_idx
  on public.activity_logs (workspace_id, created_at desc);

create index activity_logs_board_created_idx
  on public.activity_logs (board_id, created_at desc)
  where board_id is not null;

-- ---------------------------------------------------------------------------
-- board_snapshots
--
-- Periodic checkpoints of tldraw document state for recovery. Deliberately
-- NOT a per-operation event stream.
-- ---------------------------------------------------------------------------

create table public.board_snapshots (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  version integer not null
    constraint board_snapshots_version_positive check (version > 0),
  snapshot jsonb not null
    constraint board_snapshots_snapshot_is_object check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (board_id, version)
);

create index board_snapshots_board_version_idx
  on public.board_snapshots (board_id, version desc);

-- ---------------------------------------------------------------------------
-- Lifecycle triggers
-- ---------------------------------------------------------------------------

-- Every auth user gets a profile immediately, so no code path has to cope
-- with an authenticated user that has no profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Member'
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The workspace creator is always its owner-member. Doing this in a trigger
-- keeps the invariant true regardless of which code path created the row.
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$fn$;

create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- Column-level UPDATE grants stop a board editor from rewriting someone
-- else's comment text, but they cannot express "author may edit body, editor
-- may only resolve". This trigger closes that gap.
create or replace function public.enforce_comment_body_author()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if new.body is distinct from old.body
     and old.author_id is distinct from (select auth.uid()) then
    raise exception 'Only the comment author may edit the comment body'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$fn$;

create trigger comments_enforce_body_author
  before update on public.comments
  for each row execute function public.enforce_comment_body_author();
