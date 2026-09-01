# ADR 0002 — Authorization model and RLS design

- **Status:** Accepted
- **Date:** 2026-08-24
- **Phase:** 2 (Supabase foundation)

## Context

Boardly is multi-tenant. The anon key ships to every browser, so Row Level
Security is not a hardening measure layered on top of the real defence — it
**is** the defence. Anything RLS permits, a user can do with `curl`.

## Decisions

### 1. Two independent layers: column GRANTs, then row policies

Policies alone answer "which rows?" but not "which columns?". A workspace
admin with a blanket `UPDATE` grant could issue
`update workspaces set owner_id = <self>` and pass a policy that only checks
"are you an admin of this workspace?".

So each table starts at zero (`revoke all`) and is granted back deliberately,
with `UPDATE` scoped to specific columns:

| Table               | Updatable columns                                         |
| ------------------- | --------------------------------------------------------- |
| `profiles`          | `display_name`, `avatar_url`                              |
| `workspaces`        | `name`, `slug`                                            |
| `workspace_members` | `role`                                                    |
| `boards`            | `name`, `visibility`, `share_link_enabled`, `archived_at` |
| `board_members`     | `role`                                                    |
| `comments`          | `body`, `resolved_at`                                     |
| `invitations`       | _(none)_                                                  |
| `activity_logs`     | _(none — append-only)_                                    |
| `board_snapshots`   | _(none — immutable)_                                      |

`owner_id`, `created_at` and `token_hash` are unwritable through the API by
anyone. Ownership transfer is therefore necessarily a server-side operation
under the service role, which is exactly where we want that decision to live.

### 2. `SECURITY DEFINER` helpers to break policy recursion

A policy on `workspace_members` that queries `workspace_members` raises
`infinite recursion detected in policy`. The helpers
(`is_workspace_member`, `board_access_role`, …) run as their owner and so
bypass RLS on the tables they read.

Two details are non-negotiable and easy to get wrong:

- **`set search_path = ''` on every one**, with fully schema-qualified names.
  Without it a caller can put a hostile schema ahead of `public` and have the
  function execute their code with owner privileges.
- **`revoke execute … from public`**, granting only to `authenticated`.

`(select auth.uid())` is wrapped in a subquery so Postgres evaluates it once
as an InitPlan rather than once per row.

### 3. Board access precedence

`board_access_role()` resolves, in order:

1. board owner → `editor`
2. explicit `board_members` row → that row's role
3. `visibility = 'workspace'` and caller is a workspace member → `editor`
4. otherwise → no access

Step 2 preceding step 3 is what makes per-board sharing meaningful: a board
can be read-only for one person inside a workspace everyone else can edit.

### 4. Workspace admins get NO access to private boards

The tempting alternative is "admins can see everything in their workspace",
which most SaaS products do and which makes recovery of an orphaned board
easy.

We chose least privilege instead. Workspace administration is about
_membership_, not content. A board marked private is private from everyone
who was not granted access, including the workspace owner.

**Accepted cost:** if a board owner leaves the company, their private boards
are unreachable until ownership is transferred server-side. We judged a
predictable privacy guarantee more valuable than administrative convenience,
and `boards.owner_id` uses `ON DELETE RESTRICT` so the data cannot be
destroyed by the account deletion itself.

### 5. Viewers may comment

"Viewers cannot modify board content" is preserved: a comment is discussion
_about_ the board, not content _on_ it. Comment insert therefore requires only
`can_view_board`.

Body edits are restricted to the author by the `comments_enforce_body_author`
trigger. Column grants cannot express "the author may change `body`, an editor
may only change `resolved_at`", because both live in the same `UPDATE`.

### 6. Append-only activity, immutable snapshots

`activity_logs` and `board_snapshots` are never granted `UPDATE`. Absent
privileges are a stronger guarantee than a policy that could later be widened
by accident. `activity_logs.actor_id` must equal `auth.uid()` on insert, so
history cannot be forged in someone else's name.

### 7. `anon` receives nothing at all

No policy targets `anon`. Public link sharing (`boards.share_link_enabled`)
will be served in Phase 5 by a server-side route that validates a secret
token, **not** by relaxing these policies.

Note that `share_link_enabled` alone is not a security mechanism — board IDs
are UUIDs but guessability is not the point; a boolean flag grants access to
anyone who learns the ID. Phase 5 must introduce a separate share token.

## Verification

RLS is tested, not assumed. `tests/integration/` runs the **real migration
files** against a real Postgres (PGlite) and asserts denial:

- 35 RLS tests covering tenant isolation, privilege escalation, comment
  integrity, append-only logs, invitation secrecy and anonymous access.
- 36 parity tests asserting that the TypeScript `resolveBoardRole()` agrees
  with SQL `board_access_role()` across every combination of role, visibility,
  explicit grant and archived state.

The suite was mutation-checked: changing `boards_select` to `using (true)`
caused exactly the three cross-tenant tests to fail, confirming the tests can
actually detect a regression.

The parity suite immediately earned its place by catching a real bug:
`can_edit_board()` returned `NULL` rather than `false` for a user with no
access, because `NULL = 'editor'` is `NULL`. RLS treats that as deny so it
failed closed, but a boolean helper that can return `NULL` is a trap for any
caller that negates it. It is now wrapped in `coalesce(…, false)`.

## Consequences

- Authorization is enforced in the database, so a missing check in a server
  action degrades to "query returns nothing", not "data leaks".
- The TypeScript permission helpers in `src/lib/permissions/` are for UI
  affordances only and are documented as such. The parity suite stops them
  drifting from the SQL.
- Ownership transfer, invitation acceptance and admin recovery all require
  the service-role client, which is deliberately awkward to reach.
