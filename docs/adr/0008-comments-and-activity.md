# ADR 0008 — Comments and activity

- **Status:** Accepted
- **Date:** 2026-08-25
- **Phase:** 8 (Comments & activity)

## Context

The `comments` and `activity_logs` tables, their policies, and the
`comments_enforce_body_author` trigger all shipped in Phase 2. This phase is
the data access, UI and pagination on top — plus one visibility question that
had never been tested.

## Decisions

### 1. Activity is where a private board leaks, so that is what got tested

The feed is the only surface that aggregates events across a whole workspace.
Board names live in `metadata`, so a single over-permissive row would disclose
both the existence and the title of a private board to every colleague.

`activity_logs_select` already required workspace membership **and**
`can_view_board` for board-scoped rows, but nothing had ever exercised the
second half. `tests/integration/activity-visibility.test.ts` now does, and it
was **mutation tested**: dropping the `can_view_board` clause fails exactly the
two tests that should catch it.

### 2. Keyset pagination, not offset

Both feeds grow while they are being read. `OFFSET 20` after three new
comments arrive skips three rows and repeats none — or repeats them, depending
on direction. Cursors are `created_at` values and the query fetches
`limit + 1` rows to decide whether another page exists without a second
`count` query.

The PRD requires comments and activity to be paginated; this is why it also
has to be keyset.

### 3. Comment pins store page coordinates, not screen coordinates

An anchored comment is stored as `position_x` / `position_y` in the board's own
coordinate space, and converted to screen space on every camera change via
`editor.pageToScreen`. Storing screen coordinates would strand every pin the
moment somebody zoomed.

Rendering goes through tldraw's `InFrontOfTheCanvas` slot, so pins sit above
shapes but below the toolbar. `CanvasPins` takes **plain data**
(`{id, x, y, resolved, label}`) rather than comment records, so the canvas
folder stays free of feature imports and comments could be replaced without
touching tldraw integration code.

Only unresolved comments become pins. Resolved ones would clutter a board
permanently; the panel is where history lives.

### 4. Placement intercepts the pointer in the capture phase

While "Pin note" is active, the next canvas click is captured before tldraw's
tools see it — otherwise dropping a pin would also draw a shape. The cursor
becomes a crosshair, which is the only signal telling someone the click will
behave differently.

### 5. Mutations invalidate rather than patch

Unlike the board grid, comment mutations do not update the cache optimistically.
A comment needs a server-assigned id, timestamp and author profile to render;
an optimistic insert would have to invent three values and then correct them,
which shows as a visible flicker for no latency win on a sidebar.

### 6. The activity formatter is pure, and defensive on purpose

`describeActivity()` has no React imports so it can be unit tested directly.
Both defensive branches map to something the schema actually permits:

- `actor_id` is `ON DELETE SET NULL`, so the trail outlives the account and
  every message must survive a null actor — it reads "Someone".
- `metadata` is untyped `jsonb` written by older versions of the app, so no key
  can be assumed present or well-typed. A `name` that arrives as a number
  falls back to the generic phrasing rather than rendering `undefined`.

An exhaustiveness guard makes a new enum value a **compile** error rather than
a blank row in production.

The formatter also never renders an invitee's email address: the feed is
visible to every workspace member, and who was invited is not their business
until the person joins. That is asserted by a test, because it is the kind of
rule a later "helpful" change would quietly undo.

### 7. Viewers may comment

Reaffirmed in the UI: `canComment` is `board.role !== null`, not
`canEdit`. A comment is discussion _about_ the board, not content _on_ it, and
`comments_insert` requires only `can_view_board`. Body edits remain restricted
to the author by the database trigger.

Comment bodies render as text with `whitespace-pre-wrap`, never as markup.

## Verification

- **417 Vitest tests** (276 unit, 141 integration) and **41 Playwright specs**.
- 65 formatter tests, including every event type against a deleted actor, null
  metadata and array metadata.
- 11 activity-visibility tests, mutation tested as described above.
- E2E asserts both new API routes return **401 rather than a redirect** and
  never permit shared caching.

## Known gaps

- **@mentions are not implemented.** The PRD lists them as "if feasible"; they
  need a user picker, a parsing/storage format and notification semantics, none
  of which exist. Deliberately deferred rather than half-built.
- **Comments are not realtime.** They arrive on refetch, not through the
  Liveblocks room, so a collaborator's comment appears on the next
  invalidation rather than instantly. Threading them through the room is
  possible but was not attempted.
- No comment threading or replies — the schema has no `parent_id`.
- No notification when somebody comments on your board.
- Authenticated end-to-end journeys still need a linked Supabase project.
