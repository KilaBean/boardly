# ADR 0009 — Replacing tldraw with Excalidraw

**Status:** Accepted
**Supersedes:** the canvas-library decision in [ADR 0005](0005-canvas-and-sync.md); the
Yjs binding and sync design in [ADR 0006](0006-realtime-collaboration.md) and the pin
rendering in [ADR 0008](0008-comments-and-activity.md) are revised here.

## Context

tldraw 5.x refuses to run unlicensed on any domain that is not localhost.

`LicenseManager` resolves a missing key to `unlicensed-production`, and
`LicenseProvider` then renders the editor for `LICENSE_TIMEOUT` — five seconds —
before replacing the entire editor with a hidden
`<div data-testid="tl-license-expired">`. Measured on the deployed site: the
canvas holds ~41KB of DOM until t=5.5s, and at t=6.0s the container's
`innerHTML` is 101 bytes. No console error, no failed request, nothing in the
server logs.

`getIsDevelopment()` returns true for localhost, any loopback host, any plain
`http:` origin, and any build where `NODE_ENV !== "production"`. Local
development therefore sits entirely inside the exempt set, which is why this
never appeared in development or in any test run — the whole suite is local.
The only unlicensed way to keep a deployed board alive is to serve the app over
plain HTTP, which would break secure-context APIs and Supabase's `Secure`
session cookies, and is circumvention rather than compliance.

So the options were: buy a tldraw licence, stay on localhost, or change library.
The product owner chose to change library.

## Decision

**Excalidraw (`@excalidraw/excalidraw` 0.18.1, MIT) replaces tldraw.**

MIT means no licence gate, no key to provision, no per-domain registration, and
no runtime that can decide to remove itself. React 19 is supported by its peer
range.

Liveblocks, Yjs, Postgres, Supabase Auth and the whole authorization model are
untouched. The room-per-board model, the `/api/liveblocks-auth` trust boundary
and RLS all carry over unchanged: this is a canvas swap, not an architecture
change.

## Consequences

### 1. Reconciliation is now the library's, not ours

ADR 0006 accepted owning the merge rules as the cost of using `@liveblocks/yjs`.
Excalidraw exports `reconcileElements`, so we no longer do. It knows element
ordering, fractional indices and which local edits must survive a remote
update — the things that corrupt a scene subtly and only under real concurrent
editing.

It is safe to call with a _partial_ remote list, which the binding relies on:
its second loop appends every local element not present in the remote input, so
a Yjs event carrying three changed elements cannot drop the other forty.

### 2. Deletion is an update, so the sync layer lost a whole failure mode

Excalidraw never removes an element — deleting sets `isDeleted` and bumps
`version`. The shared map therefore only grows and has no delete path at all.
The "a stale local copy resurrects a deleted shape" problem that the tldraw
binding had to reason about does not exist: the tombstone _is_ an element, and
the higher version wins like any other edit.

Elements are written to the room only when their version is newer than what the
room holds. Excalidraw's `onChange` fires on every pointer move and always hands
over the whole scene, so without that filter a single drag would flood the room —
and it is also what stops an element we just applied _from_ the room being sent
straight back.

The scene is read from `getSceneElementsIncludingDeleted()` rather than from the
`onChange` argument, so tombstones are definitely included. A list that quietly
omitted them would mean deletions never reaching collaborators.

### 3. Remote changes now schedule a save, deliberately

Excalidraw's `onChange` does not say who caused a change, so a collaborator's
edit schedules a snapshot here just as a local one does.

This is the better trade rather than a limitation we accepted. It means the
durable snapshot can never fall behind the room — the exact failure that made
boards come back blank — and it does not loop, because a write to Postgres is
not broadcast to anyone. Redundant writes are suppressed by comparing
`getSceneVersion()` against the version already saved, which also removes the
special-cased backfill the tldraw implementation needed.

### 4. Pins are an overlay, not an editor slot

ADR 0008 rendered comment pins through tldraw's `InFrontOfTheCanvas`.
Excalidraw draws to a `<canvas>` and has no equivalent, so pins are real DOM
positioned by the same transform the canvas uses:
`(scene + scroll) × zoom`. Positions are still stored in scene space and
converted on every pan and zoom.

The connection, collaborator and save indicators moved into Excalidraw's
`renderTopRightUI`, which lays them out beside its own controls. The
absolutely-positioned overlay they used before sat on top of the Library button.

### 5. Snapshots changed shape and old ones cannot be migrated

Snapshots are `{ elements, appState.viewBackgroundColor, files }` rather than
tldraw's `{ store, schema }`. The column stays opaque `jsonb`, so no migration
runs, but the two libraries share no document model and **existing snapshots
cannot be converted**. `parseScene` treats them as unreadable and renders an
empty board rather than throwing, and `isLegacyTldrawSnapshot` names the case
explicitly so it is not mistaken for corruption.

Images ride along in the snapshot as data URLs. An image element without its
file renders as a broken placeholder, so splitting them would mean a board that
reloads visibly incomplete. This makes an image-heavy board the realistic way to
hit the action's 5MB cap; moving files to Supabase Storage is the fix when that
becomes a problem.

### 6. Per-shape DOM assertions are gone from the E2E suite

`.tl-shape` had no Excalidraw equivalent — there is no per-shape DOM to count.
The collaboration test now compares screenshots of `canvas.excalidraw__canvas.static`,
which holds committed elements only; selection outlines and collaborator cursors
render on a separate interactive canvas, so a pixel change means the drawing
itself changed rather than somebody's mouse moving.

## Verification

Against the live Supabase and Liveblocks projects, through a real browser:

- The canvas is still present at t=10s. This is the specific thing tldraw failed:
  it blanked at t=6.0s on the same infrastructure.
- A rectangle drawn with the mouse, then duplicated, produced a snapshot holding
  **2 elements**, and both rendered after a reload.
- The save indicator reached "All changes saved"; no console errors.
- 479 unit and integration tests, 42 anonymous E2E specs, typecheck, lint and a
  production build all pass.

Not verified here: the authenticated E2E suite, which needs a local Supabase
instance that this environment does not have. Its selectors were updated but
have not been executed.

## Alternatives considered

**Buy a tldraw licence.** Keeps the stack as originally briefed and is the least
work — one environment variable, already wired before this decision. Rejected by
the product owner in favour of removing the dependency on a licence entirely.

**Serve over plain HTTP to stay inside tldraw's development check.** Rejected:
it drops TLS, breaks Supabase's `Secure` cookies, and evades the licence rather
than satisfying it.

**Build a custom canvas.** Explicitly out of scope per the project rules, and it
would mean owning hit-testing, text editing, freedraw smoothing and export.
