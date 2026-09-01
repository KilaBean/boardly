# ADR 0005 — Canvas integration and the real-time sync decision

- **Status:** Accepted
- **Date:** 2026-08-24
- **Phase:** 5 (Canvas)
- **Supersedes:** the open question left in [ADR 0001](0001-foundation-toolchain.md)

## Context

ADR 0001 recorded that **`@liveblocks/react-tldraw` does not exist** and
deferred the choice of how to bind tldraw to a real-time backend. That
decision had to be settled before building the canvas, because it determines
where the document lives and therefore how persistence is shaped.

## The sync decision

### Findings

Checked against the registry and tldraw's own bundled documentation rather
than assumed:

- Liveblocks ships integrations for **Lexical, Tiptap, BlockNote, ProseMirror,
  React Flow, Redux and Zustand — and nothing for tldraw.**
- No `y-tldraw` or `tldraw-yjs` package exists.
- `@tldraw/sync` exists, but `useSyncDemo` connects to a **public demo server
  whose data expires after 24 hours**. tldraw's docs state production requires
  self-hosting the sync server.
- tldraw's docs explicitly point at Liveblocks as a worked example of using
  another backend.
- `@tldraw/commenting` exists but is a **licensed** feature.

### Decision: `@liveblocks/yjs` with a Yjs binding we write

|                    | `@liveblocks/yjs` + Yjs                | `@tldraw/sync` (self-hosted)    |
| ------------------ | -------------------------------------- | ------------------------------- |
| Room authorization | Our endpoint, from Postgres membership | A second auth surface           |
| Infrastructure     | Liveblocks (already in the stack)      | A persistent WebSocket server   |
| Fits Vercel        | Yes                                    | No — needs a long-lived process |
| Binding code       | We write and maintain it               | Provided                        |

The deciding factor is the invariant in `ARCHITECTURE.md`: _a board's real-time
room is authorized from the same membership model used by application APIs._
`@liveblocks/yjs` keeps that in one place — a server endpoint that reads
Postgres and issues a room token. `@tldraw/sync` would require standing up a
second backend service, which the PRD names as a non-goal, and would put
authorization in two systems.

**Accepted cost:** we own the Yjs↔tldraw binding, which is genuinely non-trivial
(record mapping, undo scoping, schema migration). That work is Phase 6.

**Also decided:** comments will be our own Postgres-backed implementation, not
`@tldraw/commenting`. The PRD already specifies a `comments` table with
anchoring and resolution, and the tldraw package is licensed.

## Canvas architecture

### 1. tldraw is isolated behind one folder

Everything tldraw-specific lives in `src/features/boards/canvas/`. No editor
instance, store record or tldraw type escapes into the dashboard. Phase 6
replaces how the store is constructed inside `BoardCanvas` — not the
surrounding application.

### 2. Client-only, dynamically imported

tldraw is the largest dependency in the app by a wide margin: it compiles to a
**1.6 MB chunk**. `dynamic(..., { ssr: false })` keeps it out of the server
bundle and out of every route that merely links to a board, so the dashboard
never pays for it.

### 3. Only `document` is persisted, never `session`

`editor.getSnapshot()` returns `{ document, session }`. `document` is shapes,
pages and bindings; `session` is camera position, selection and UI flags.

Only `document` goes to Postgres. Persisting `session` would mean one
collaborator's scroll position yanking everyone else's viewport the next time
the board opened.

### 4. Snapshots are opaque, but bounded

The snapshot is stored as `jsonb` without structural validation, deliberately:
tldraw owns that schema and migrates documents itself, so a validator here
would reject valid documents the day tldraw adds a record type.

What _is_ enforced is the boundary — it must be a JSON object (matching the
`board_snapshots_snapshot_is_object` CHECK) and at most **5 MB**. Without a
size cap the save action is a hole for writing arbitrarily large blobs into
Postgres, since the caller controls the payload entirely.

### 5. Autosave: quiet period _and_ maximum wait

A plain debounce fails the main use case — somebody drawing continuously never
pauses long enough to trigger a save. A plain interval writes when nothing
changed. So `createSaveScheduler` fires on either condition: 2s of stillness,
or 15s since the first unsaved change.

Store listening is filtered to `{ source: "user", scope: "document" }`. Without
the source filter, applying a restored or remote change would itself schedule a
save and two clients would ping-pong writes forever. This is extracted into
`src/lib/scheduling/` so the timing rules are testable with fake timers rather
than by drawing and waiting.

On unmount the scheduler **flushes rather than cancels** — navigating away is
the most common exit, and discarding the last few seconds of work would be
indefensible. It also flushes on `visibilitychange`, the last reliable moment
on mobile before a tab is discarded.

### 6. Version conflicts resolve by retry, not locking

Two collaborators autosaving together compute the same next version.
`unique (board_id, version)` is the arbiter and the action retries on SQLSTATE
`23505` — the same pattern as workspace slugs. No advisory locks, no
transaction, one source of truth.

### 7. Read-only is enforced in the editor, not just hidden

Viewers get `editor.updateInstanceState({ isReadonly: true })`. Hiding the
toolbar alone would leave keyboard shortcuts and paste working. Underneath
that, `board_snapshots_insert` requires `can_edit_board()`, so a viewer who
defeats the UI still cannot write.

## Verification

- **265 Vitest tests** (153 unit, 112 integration) and 27 Playwright specs.
- 12 scheduler tests with fake timers cover the quiet period, the maximum-wait
  safety net, flush-on-exit, and the configuration guard.
- 12 snapshot tests against the real policies confirm viewers, outsiders and
  archived boards are refused writes; that viewers may still read; that
  duplicate versions are rejected (which is what makes retrying correct); and
  that snapshots are immutable.
- The canvas was **loaded in a real browser**: the tldraw container and canvas
  mount, 29 tools render, the `d` keyboard shortcut switches tools, and the
  page produces **zero console errors**.

## Known gaps

- **The autosave round trip is not verified end to end.** Synthetic pointer
  events did not reproduce a stroke against tldraw's pointer capture, and the
  save action requires a session. The scheduler, the action and the policies
  are each tested in isolation; the seam between them is not.
- **Snapshots accumulate without bound.** Pruning needs the service role
  (`board_snapshots_delete` requires `is_board_owner`, so a collaborator's save
  cannot prune), so it belongs in a scheduled job rather than the save path.
- No image/asset upload to Supabase Storage yet.
- No restore UI for archived boards.
