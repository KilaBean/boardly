-- ============================================================================
-- Boardly — secure share links
--
-- ADR 0002 flagged that `boards.share_link_enabled` on its own is not a
-- security mechanism: a boolean grants access to anyone who learns the board
-- id, and ids travel in URLs, logs and screenshots. A share link needs a
-- secret.
--
-- As with invitations, only a HASH of the token is stored. The raw token
-- exists solely in the shared URL, so a database dump cannot be replayed into
-- board access.
-- ============================================================================

alter table public.boards
  add column share_token_hash text
    constraint boards_share_token_hash_length
      check (share_token_hash is null or char_length(share_token_hash) between 32 and 128);

-- Lookup path for /share/<token>. Partial: most boards have no share link.
create unique index boards_share_token_hash_idx
  on public.boards (share_token_hash)
  where share_token_hash is not null;

-- The point of the migration: link sharing cannot be switched on without a
-- token to guard it. Enforced by the database, not by remembering to set both.
alter table public.boards
  add constraint boards_share_link_requires_token
    check (share_link_enabled = false or share_token_hash is not null);

-- ---------------------------------------------------------------------------
-- The token hash must be no more readable than an invitation's.
--
-- A table-wide SELECT grant would expose it to any authenticated member of the
-- workspace, who could then reconstruct the share URL. Replacing it with
-- column-level grants keeps every other column readable while making this one
-- unreadable through the API entirely — resolving a share token is a
-- server-side operation under the service role.
-- ---------------------------------------------------------------------------

revoke select on public.boards from authenticated;

grant select (
  id,
  workspace_id,
  name,
  owner_id,
  visibility,
  share_link_enabled,
  created_at,
  updated_at,
  archived_at
) on public.boards to authenticated;

-- share_token_hash is deliberately absent from the UPDATE grant as well, so
-- rotating a link is likewise server-side only.
