# ADR 0007 — Sharing, permissions and invitations

- **Status:** Accepted
- **Date:** 2026-08-25
- **Phase:** 7 (Sharing & permissions)
- **Closes:** the `share_link_enabled` weakness flagged in [ADR 0002](0002-authorization-model.md)

## Context

ADR 0002 shipped `boards.share_link_enabled` as a plain boolean and recorded
that this is **not a security mechanism**: a flag grants access to anyone who
learns the board id, and ids travel in URLs, logs and screenshots. This phase
fixes that and adds the invitation flow.

## Decisions

### 1. A share link is a secret, enforced by the database

`boards.share_token_hash` stores a SHA-256 hash of a 256-bit token. The raw
token exists only in the shared URL, so a database dump yields nothing
replayable — the same rule invitations already followed.

A CHECK constraint makes the pairing structural rather than remembered:

```sql
check (share_link_enabled = false or share_token_hash is not null)
```

Link sharing **cannot be switched on without a token**. This is the fix; the
rest is plumbing.

### 2. The token hash is unreadable through the API

A table-wide `SELECT` grant would expose the hash to every workspace member,
who could then work backwards toward the URL. So the blanket grant is replaced
with column-level grants that simply omit it:

```sql
revoke select on public.boards from authenticated;
grant select (id, workspace_id, name, owner_id, visibility,
              share_link_enabled, created_at, updated_at, archived_at)
  on public.boards to authenticated;
```

`share_token_hash` carries no SELECT and no UPDATE grant for any API role.
Reading and rotating are service-role operations.

**Consequence, accepted deliberately:** an existing share URL can never be
displayed again — only its fingerprint is stored. The UI offers "Regenerate"
instead of "Copy existing link", and regenerating revokes the old link. That
is the honest cost of not storing the secret, and the dialog says so.

### 3. Share links are read-only and roomless

`/share/<token>` renders the latest snapshot with `collaborative={false}`: no
Liveblocks room, no presence, no writes. An anonymous visitor has no room
access and should not get one.

The page is `robots: noindex` — a share link is a bearer credential, and
letting it into a search index would turn "anyone with the link" into "anyone
at all". Invalid, revoked, disabled and archived links are all a plain 404.

The canvas grew a `collaborative` prop and split into two components rather
than branching internally, because the collaborative path calls hooks the
static path must not, and hooks cannot be conditional.

### 4. Acceptance is one SQL function, not two round trips

Accepting an invitation is two writes — create the membership, mark the
invitation used — and they must not come apart. Two PostgREST calls leave a
window where a crash either grants access to a still-unused invitation or
burns an invitation that granted nothing.

`accept_invitation()` is one transaction. It is `SECURITY DEFINER` because the
invitee, by definition, cannot yet insert their own membership row, so it does
its own authorization:

- rejects an unauthenticated caller (and `anon` has no EXECUTE grant at all)
- `SELECT … FOR UPDATE` serializes concurrent acceptances, so a link opened
  twice cannot be consumed twice
- **requires the signed-in user's email to match the invited address** — an
  invitation is addressed to a person, not to whoever holds the link
- `ON CONFLICT DO NOTHING` for workspace membership, so a stale `member`
  invitation accepted by an owner never demotes them
- one identical error for "unknown", "already used" and "expired", so a bad
  token cannot be probed for why it failed

Returning `jsonb` rather than `RETURNS TABLE` is not cosmetic: table output
column names become PL/pgSQL variables and collide with the identically-named
columns in the INSERT statements. That produced a real
`column reference "board_id" is ambiguous` failure, caught by the tests.

### 5. Invitations carry no email delivery yet

No mail provider is configured, so `createInvitationAction` returns the link
and the inviter sends it. The raw token therefore crosses back to the client
exactly once and is never stored.

The activity log records the role and target of an invitation but **not the
email address** — activity is visible to every workspace member, and who was
invited where is not their business until the person joins.

## Verification

- **341 Vitest tests** (211 unit, 130 integration) and **37 Playwright specs**.
- 18 invitation tests against the real function: single use, expiry, email
  mismatch, unauthenticated, cross-workspace board access, no role downgrade,
  activity logging.
- 9 share-link tests proving sharing cannot be enabled without a token, that
  the hash is unreadable and unwritable even by the board owner, that hashes
  are unique across boards, and that ordinary columns still read fine after
  the grant change.
- 23 token tests including `isPlausibleToken` rejecting path traversal, SQL
  payloads, markup and non-strings.
- **Mutation tested:** removing the email-match check fails exactly the
  "refuses a user whose email does not match" test, and passes again on
  restore.

## Known gaps

- **No email delivery.** Invitations are copy-a-link. Wiring a provider is a
  small change to `createInvitationAction`, but until then the flow depends on
  the inviter having another channel.
- **Workspace member management has no UI.** The actions and policies exist
  (`setWorkspaceMemberRoleAction`, `removeWorkspaceMemberAction`) and are
  covered by RLS tests, but nothing renders them yet — only board-level
  sharing has a dialog.
- Share links are view-only by design; there is no editable link.
- Authenticated end-to-end journeys still need a linked Supabase project.
- No rate limiting on invitation creation. The PRD asks for it on sensitive
  endpoints; Supabase's own limits do not cover this action.
