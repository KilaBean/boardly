# ADR 0004 — Workspace and board data flow

- **Status:** Accepted
- **Date:** 2026-08-24
- **Phase:** 4 (Workspaces & boards)

## Context

Boards and workspaces are the first features with real CRUD. The architecture
question is where data is read, where it is written, and how permission checks
avoid being duplicated into application code that can drift from the policies.

## Decisions

### 1. Server components read first, TanStack Query takes over

The workspace page fetches boards on the server and passes them to the client
grid as `initialData`. The first paint therefore shows real boards, not a
skeleton, and there is no request waterfall.

TanStack Query then owns the list, because the board grid is genuinely
interactive: create, rename and archive should feel instant, which needs
optimistic updates and a cache to roll back to. Using Query _only_ for a
static list would be cargo cult; using it here is what it is for.

### 2. Reads via GET route handler, writes via server actions

Server actions are POST-only and Next.js runs them sequentially — correct for
mutations, wasteful for a list refetched on invalidation. So
`GET /api/workspaces/[workspaceId]/boards` serves refetches, and mutations stay
in server actions where `revalidatePath` and activity logging live.

The route sets `Cache-Control: private, no-store`: the response is per-user and
must never be held by a shared cache.

### 3. The row count _is_ the permission check

No mutation checks permissions in application code. Every one uses
`.select().maybeSingle()` and treats a null result as "not permitted":

```ts
const { data } = await supabase.from("boards").update(...).eq("id", id).select("id").maybeSingle();
if (!data) return fail(PERMISSION_DENIED);
```

RLS filters the row out for an unauthorized user, so the update matches nothing.
This matters because the check **cannot be forgotten** — it is the same code
path that fetches the result. A separate `if (!canEdit)` guard is a line
someone can omit; this is not.

### 4. Insert-and-retry for slugs, not check-then-insert

Workspace slugs are globally unique. "Query for the slug, then insert if free"
races against a concurrent create and needs a transaction to close the window.

Instead we insert optimistically and retry on SQLSTATE `23505`, appending a
numeric suffix, up to five attempts. The unique index remains the only arbiter
of uniqueness — no second source of truth, no race.

### 5. Slug generation is verified against the database, not a copy of the rules

`slugify()` must satisfy `workspaces_slug_format` and `workspaces_slug_length`.
A unit test can only assert against a _transcription_ of those constraints,
which is exactly the duplication that drifts.

So `tests/integration/slug-constraints.test.ts` feeds 20 hostile names
(emoji-only, CJK, accents, 200 characters, `---`, whitespace) through
`slugify()` and inserts the results into the real table. A companion suite
asserts the constraints still reject known-bad slugs, so the first cannot pass
vacuously.

### 6. Inaccessible workspaces return 404, not 403

`getWorkspaceBySlug()` returns null for both "does not exist" and "you are not
a member", because RLS makes them indistinguishable — and that is the correct
behaviour. A 403 would confirm the workspace exists to someone who should not
know that.

### 7. Archive is the default; delete is the exception

Archiving is reversible, so it acts immediately from the menu with an undo-able
toast and no confirmation dialog. Deletion cascades to comments, snapshots and
shared access, so it gets a dialog that names the board and points at archiving
as the safer option.

Note the asymmetry this relies on: `can_edit_board()` returns false for an
archived board (contents freeze), but `boards_update` is governed by
`is_board_owner`, which is what still allows restoring it.

### 8. Activity logging never throws

`logActivity()` swallows its errors. The user's operation has already
succeeded by the time it runs; failing the request — or rolling back — because
a secondary audit row could not be written would be worse than a gap in the
feed.

It inserts as the user, not the service role, so RLS still applies:
`actor_id` must equal `auth.uid()`. The helper cannot forge history even if
called incorrectly. Its dev-only warning deliberately omits metadata, which
contains board names — user content does not belong in server logs.

### 9. `useWatch`, not `watch()`

React Compiler is enabled and reported `Compilation Skipped: Use of
incompatible library` on two components: React Hook Form's `watch()` returns a
fresh function each render, so the compiler bails out of memoizing the entire
component. `useWatch({ control, name })` is subscription-based and compiler
safe. Switching fixed both warnings rather than suppressing them.

## Verification

- **241 Vitest tests** (141 unit, 100 integration) and **27 Playwright specs**.
- E2E asserts every new route (`/dashboard`, `/onboarding`, `/w/[slug]`,
  `/board/[id]`) rejects anonymous visitors and preserves `?next=`, and that
  the API returns **401 rather than a redirect** — an HTML sign-in page would
  surface to a fetch caller as a confusing JSON parse error.

## Known gaps

- Authenticated journeys (create workspace → create board → rename → archive)
  are not E2E tested; they need a linked Supabase project. Documented in
  `tests/e2e/workspaces.spec.ts`.
- Archived boards have no restore UI yet — the action and policy exist, but
  nothing lists archived boards.
- Board thumbnails are a placeholder block; real previews need the canvas.
- Workspace settings, member management and invitations are Phase 6.
