# ADR 0006 — Real-time collaboration

- **Status:** Accepted
- **Date:** 2026-08-24
- **Phase:** 6 (Real-time)
- **Implements:** the sync decision recorded in [ADR 0005](0005-canvas-and-sync.md)

## Context

ADR 0005 chose `@liveblocks/yjs` over `@tldraw/sync`, on the grounds that room
access must derive from the same membership model as the HTTP APIs. This ADR
records how that was built.

## Decisions

### 1. Room authorization calls the same SQL function as RLS

`POST /api/liveblocks-auth` decides access by calling
`public.board_access_role()` and `public.can_edit_board()` — **the same
functions the RLS policies use**, not a reimplementation of the rules.

This is the whole invariant in one place. If a policy changes, room access
changes with it automatically, because there is only one definition of who may
open a board.

It matters more than it might look: **a Liveblocks access token bypasses
Postgres entirely once issued.** Whatever this endpoint grants is what the user
can actually do in the room, so it is the last moment the question can be
asked.

| Caller                               | Result        |
| ------------------------------------ | ------------- |
| No session                           | `401`         |
| Room name not a valid `board:<uuid>` | `403`         |
| `board_access_role()` returns null   | `403`         |
| `can_edit_board()` true              | `["*:write"]` |
| Viewer, or archived board            | `["*:read"]`  |

`FULL_ACCESS`/`READ_ACCESS` are deprecated in `@liveblocks/node`, so the scope
literals are used directly.

### 2. The room name is a trust boundary

The room name is the only value the client sends to the auth endpoint, and the
board id is extracted from it _before_ permissions are checked. A parser that
accepted something it should not would point authorization at the wrong board.

`parseBoardRoomId()` therefore requires the exact `board:` prefix and a
well-formed RFC 4122 uuid, lowercases the result so one board cannot become
two rooms, and returns `null` rather than throwing — so an unparseable room and
an unauthorized room produce the same 403 and cannot be used to probe which
boards exist. 22 unit tests cover it.

### 3. Three layers, deliberately separate

| Layer              | Carries                      | Lifetime                                      |
| ------------------ | ---------------------------- | --------------------------------------------- |
| Yjs document       | Shapes, pages, bindings      | Live; authoritative while anyone is connected |
| Yjs awareness      | Cursors, selection, viewport | Ephemeral; dropped on disconnect              |
| Postgres snapshots | Document backup              | Durable                                       |

**Presence goes over awareness, never the document.** Awareness is dropped when
a client disconnects, which is exactly right for cursor positions — and putting
them in the document would grow it without bound and place pointer movement on
a path toward Postgres, which the architecture forbids outright.

**Snapshots became a backup, not the live path.** They now start only once the
room has synced; saving earlier could persist our local snapshot over a room
that already had newer content.

### 4. The echo-loop guard

Yjs delivers every transaction to observers, _including your own_. Without an
origin to compare against, applying a local edit would arrive back as a
"remote" change, be re-applied to the store, emit another local change, and
loop forever.

Every local write is tagged `LOCAL_ORIGIN` and `readRemoteChanges()` returns
nothing for a transaction bearing it. Symmetrically, every write _into_ the
store goes through `store.mergeRemoteChanges()`, which marks it source
`"remote"`, while our store listener subscribes only to source `"user"`. Both
directions are guarded.

This is the single most important correctness property in the phase, so it was
**mutation tested**: removing the origin check causes exactly the
"ignores our own transaction" test to fail.

### 5. First client in seeds; a live room always wins

On connect, an empty room is seeded from the snapshot already loaded into the
store. A **non-empty room is never overwritten** — it is the live document, and
seeding over it would silently discard whatever collaborators had done since
our snapshot was taken.

### 6. The sync layer has no tldraw or Liveblocks imports

`yjs-sync.ts` moves plain records in and out of a `Y.Map` and knows nothing
about editors or rooms. That is what makes the error-prone part testable: 13
tests run it against **two real Y.Docs wired directly together**, with no
browser, no network and no credentials — including a convergence test proving
concurrent edits from both peers reach identical state.

### 7. Connection status is invisible while healthy

The PRD requires connection state to be visible when disconnected or
reconnecting. It renders nothing when connected: a permanent "connected" badge
is noise that trains people to ignore the one moment it matters.

Collaborator avatars always carry names (via `alt` and screen-reader text), so
people are never distinguished by cursor colour alone.

## Verification

- **300 Vitest tests** (188 unit, 112 integration) and **31 Playwright specs**.
- 13 Yjs sync tests against two real connected documents, including
  convergence and batching (30 shapes produce **one** update, not thirty).
- 22 room-name parsing tests covering wrong prefixes, trailing junk, path
  traversal, invalid uuid variant bits and non-string input.
- The echo-loop guard was mutation tested — see above.
- E2E asserts the auth endpoint returns 401 to anonymous callers and that
  **nothing resembling a JWT appears in the response body**.

## Known gaps — significant

- ~~The collaborative round trip is not verified end to end.~~ **Closed.**
  With real Liveblocks credentials and a local Supabase stack,
  `tests/e2e/authenticated/collaboration.spec.ts` now runs two browser
  contexts against a real room and asserts that both see each other's
  presence and that **a shape drawn by one appears for the other** — the
  PRD's two-browser-context requirement. Room authorization is also checked
  against the live endpoint: a member receives a token, a non-member gets 403.
  See [ADR 0008](0008-live-stack-verification.md).
- **Snapshot write churn.** Every connected editor autosaves, so a busy board
  produces redundant versions. Unique `(board_id, version)` plus retry makes
  this correct but wasteful; electing a single writer per room would fix it.
- Undo/redo is per-client tldraw history and is not collaboration-aware — a
  user can undo their own change but the interaction with concurrent remote
  edits is untested.
- No offline queue beyond what Liveblocks provides by default.
- Follow-a-collaborator ("viewport following") is not implemented.
