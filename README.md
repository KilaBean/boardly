# Boardly

Real-time collaborative whiteboard SaaS. Create workspaces and boards, draw on an infinite canvas, and collaborate live.

> **Status: Phase 8 (Comments & activity) complete.** All MVP feature areas are implemented: auth, workspaces, boards, canvas, live collaboration, sharing, comments and activity. Remaining work is production configuration and the authenticated end-to-end test layer.

## Stack

| Concern             | Choice                      |
| ------------------- | --------------------------- |
| Framework           | Next.js 16 (App Router)     |
| Language            | TypeScript 5.9 (strict)     |
| Styling             | Tailwind CSS v4 + shadcn/ui |
| Icons               | Lucide React                |
| Canvas              | tldraw _(Phase 3)_          |
| Real-time           | Liveblocks _(Phase 4)_      |
| Auth / DB / Storage | Supabase _(Phase 4–5)_      |
| UI state            | Zustand                     |
| Server state        | TanStack Query              |
| Forms + validation  | React Hook Form + Zod       |
| Unit / integration  | Vitest                      |
| End-to-end          | Playwright                  |
| Hosting             | Vercel                      |

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in real values
npm run dev
```

> `.env.local` is now **required**: the auth routes import the validated env
> modules, so a missing variable is a startup error by design. Placeholder
> values are enough to build and run the test suite; real Supabase credentials
> are needed to actually sign in. See [Environment](#environment).

## Scripts

| Script                  | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `npm run dev`           | Dev server                                       |
| `npm run build`         | Production build                                 |
| `npm run start`         | Serve the production build                       |
| `npm run typecheck`     | Route typegen + `tsc --noEmit`                   |
| `npm run lint`          | ESLint                                           |
| `npm run format`        | Prettier write                                   |
| `npm run test`          | Vitest (unit + integration)                      |
| `npm run test:coverage` | Vitest with V8 coverage                          |
| `npm run test:e2e`      | Playwright (runs against a **production** build) |
| `npm run verify`        | typecheck → lint → test → build                  |

## Architecture

Boardly is a **modular monolith**. The one rule that matters most is the separation of state:

| State                              | Owner               | Never used for              |
| ---------------------------------- | ------------------- | --------------------------- |
| Ephemeral UI (active tool, panels) | Zustand             | Caching server data         |
| Application data (boards, members) | TanStack Query      | Canvas contents             |
| Live canvas + presence             | Liveblocks + tldraw | Durable records             |
| Durable relational data            | Supabase Postgres   | Per-operation event streams |

**Critical invariant:** a board's Liveblocks room is authorized from the _same_
membership model the HTTP APIs use. The room token is an authorization decision
made on the server, never a client-side role check.

Canvas persistence uses periodic **snapshots**, not an operation log. Cursor and
pointer movement never touches Postgres.

### Directory layout

```
src/
  app/                 # App Router routes
  components/
    layout/            # Shell chrome
    providers/         # Theme + TanStack Query composition
    ui/                # shadcn/ui primitives
  config/              # Static, non-secret product config
  features/
    auth/              # Auth server actions + forms
    workspaces/        # Workspace data, actions, switcher
    boards/
      canvas/          # tldraw integration (isolated)
      snapshots/       # Document persistence
    sharing/           # Share links, invitations, membership
    comments/          # Comment data, actions, panel
    activity/          # Activity feed + event formatting
  lib/
    env/               # Zod-validated environment (client/server split)
    activity/          # Activity log helper
    liveblocks/        # Room naming + collaborator colours
    tokens/            # Bearer-token primitives (hash, compare)
    scheduling/        # Autosave scheduler
    auth/              # Data Access Layer + redirect safety
    workspaces/        # Slug generation
    supabase/          # client / server / admin / session helpers
    permissions/       # Board + workspace rules (UI affordances only)
    validation/        # Zod schemas for untrusted input
    invitations/       # Token generation and hashing
  types/               # Database types
  proxy.ts             # Next 16 proxy (formerly middleware.ts)
supabase/
  migrations/          # Schema, authorization helpers, RLS policies
tests/
  unit/  integration/  e2e/  helpers/
```

The remaining folders (`stores/`, `hooks/`, `lib/liveblocks`) arrive with the
code that needs them rather than as empty scaffolding.

### Authentication

Three layers, only two of which are trustworthy:

| Layer                 | Role                                                      | Security boundary?          |
| --------------------- | --------------------------------------------------------- | --------------------------- |
| `src/proxy.ts`        | Refreshes the session, redirects unauthenticated visitors | **No** — optimistic UX only |
| `src/lib/auth/dal.ts` | `requireUser()`, revalidated against the auth server      | Yes                         |
| RLS policies          | Row-level authorization                                   | Yes — last line             |

Deleting the proxy would leak nothing; pages would simply render before
redirecting. The server always uses `getUser()` (revalidates the token), never
`getSession()` (trusts the cookie).

Sign-in, sign-up and password reset return **uniform responses** whether or not
an account exists, so the forms cannot be used to enumerate users. The `?next=`
redirect parameter is validated by `safeRedirectPath()` against open redirect.

See [ADR 0003](docs/adr/0003-authentication.md).

### Data flow

Server components fetch initial data so the first paint is real content, then
TanStack Query owns interactive lists for optimistic create/rename/archive.
Reads refetch through a GET route handler; writes go through server actions.

Mutations never check permissions in application code. Each uses
`.select().maybeSingle()` and treats a null result as "not permitted" — RLS
filters the row out, so an unauthorized update simply matches nothing. The
check cannot be forgotten because it _is_ the code path that fetches the
result.

See [ADR 0004](docs/adr/0004-workspaces-and-boards.md).

### Canvas

tldraw is confined to `src/features/boards/canvas/` — no editor instance or
store record escapes into the rest of the app. It is loaded with
`dynamic(..., { ssr: false })` because it compiles to a 1.6 MB chunk that no
other route should pay for.

Only the `document` half of a tldraw snapshot is persisted, never `session`:
session state is camera and selection, and saving it would move every
collaborator's viewport. Autosave fires after 2s of stillness **or** 15s of
continuous drawing, because a plain debounce never triggers for someone who
does not pause.

### Real-time collaboration

Three layers, deliberately separate:

| Layer              | Carries                      | Lifetime                                      |
| ------------------ | ---------------------------- | --------------------------------------------- |
| Yjs document       | Shapes, pages, bindings      | Live; authoritative while anyone is connected |
| Yjs awareness      | Cursors, selection, viewport | Ephemeral; dropped on disconnect              |
| Postgres snapshots | Document backup              | Durable                                       |

Cursors travel over **awareness, never the document** — they are worthless a
second later, and persisting them would put pointer movement on a path toward
Postgres.

**Room authorization is the architecture's critical invariant.**
`/api/liveblocks-auth` decides access by calling `board_access_role()` and
`can_edit_board()` — the _same SQL functions the RLS policies use_, not a
reimplementation. A Liveblocks token bypasses Postgres once issued, so this is
the last place the question can be asked.

See [ADR 0005](docs/adr/0005-canvas-and-sync.md) for why `@liveblocks/yjs`
rather than `@tldraw/sync`, and [ADR 0006](docs/adr/0006-realtime-collaboration.md)
for how it is built.

### Sharing

Invitations and share links are **bearer credentials**, so only a SHA-256 hash
of each is stored. The raw token exists once — in the emailed link or the
shared URL — and a database dump yields nothing replayable.

A database constraint makes link sharing structurally safe rather than
carefully remembered:

```sql
check (share_link_enabled = false or share_token_hash is not null)
```

`share_token_hash` carries no SELECT or UPDATE grant for any API role, so an
existing share URL can never be shown again — the dialog offers "Regenerate",
which also revokes the old link.

`/share/<token>` is the only route reachable without a session. It renders a
snapshot read-only, joins no collaboration room, and is `noindex`.

Accepting an invitation runs in a single SQL function so the membership and
the "used" flag cannot come apart, and it requires the signed-in email to
match the invited address.

See [ADR 0007](docs/adr/0007-sharing-and-invitations.md).

### Comments and activity

Both feeds are **keyset paginated**, not offset — they grow while being read,
so `OFFSET` would skip or repeat rows as new entries arrive.

Anchored comments store **page coordinates**, converted to screen space on
every camera change. Storing screen coordinates would strand every pin the
moment somebody zoomed.

The activity feed is the only surface aggregating events across a workspace,
which makes it the most likely place for a private board to leak — board names
live in event metadata. `activity_logs_select` requires workspace membership
_and_ `can_view_board`, and that second half is mutation-tested.

See [ADR 0008](docs/adr/0008-comments-and-activity.md).

### Authorization

Row Level Security is the security boundary, not a hardening layer: the anon
key ships to every browser, so anything RLS permits is reachable with `curl`.

Two layers guard each table — column-level `GRANT`s decide which columns a
role may write at all, and policies decide which rows. `owner_id` and
`token_hash` carry no `UPDATE` grant from any role, so privilege escalation is
impossible at the SQL level rather than merely discouraged.

`src/lib/permissions/` mirrors these rules in TypeScript **for UI affordances
only**. An integration suite asserts the two implementations agree, so they
cannot drift.

See [ADR 0002](docs/adr/0002-authorization-model.md) and
[docs/supabase-setup.md](docs/supabase-setup.md).

## Environment

Copy `.env.example` to `.env.local`. Variables are validated with Zod at import
time and split into two entrypoints:

- **`src/lib/env/client.ts`** — `NEXT_PUBLIC_*` only. Inlined into the browser bundle.
- **`src/lib/env/server.ts`** — secrets. Imports `server-only`, so any client
  component that reaches it **fails the build** instead of shipping a
  service-role key to the browser.

`.env.local` is gitignored; `.env.example` contains placeholders only.

## Testing

Vitest runs two projects:

- **`unit`** (jsdom) — env validation, permission rules, Zod schemas,
  invitation tokens, components.
- **`integration`** (Node) — boots a real Postgres via PGlite, applies the
  **actual migration files**, and asserts that RLS denies what it should.
  Reviewing policy SQL by eye is not evidence that it denies anything.

```bash
npm run test -- --project unit
```

**Playwright** covers user journeys and runs against a **production build**.
The dev server emits HMR websocket traffic and dev-only `403`s on `/_next`
assets, which would make the "no console errors" assertion permanently red.

## Running the authenticated tests

The authenticated E2E layer needs a real auth server. A local Supabase stack
provides one — no cloud project, no credentials to manage:

```bash
supabase start -x storage,imgproxy,studio,analytics,vector,edge-runtime,functions,realtime,inbucket
```

Copy the printed `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY` into `.env.local`,
then:

```bash
npm run test:e2e
```

Playwright enables the authenticated projects **only** when `.env.local` points
at a local Supabase, so the suite still passes without Docker — it runs the
anonymous tests alone. Set `E2E_REQUIRE_AUTH=1` in CI to turn that skip into an
error.

Live collaboration additionally needs Liveblocks keys in `.env.local`; without
them everything else still runs.

Running this for the first time found three production-breaking bugs that unit
and integration tests had all passed over; [ADR 0008](docs/adr/0008-live-stack-verification.md)
records them.

## Documentation

| Document                                          | Covers                                       |
| ------------------------------------------------- | -------------------------------------------- |
| [ADR 0001](docs/adr/0001-foundation-toolchain.md) | Toolchain version pinning and why            |
| [ADR 0002](docs/adr/0002-authorization-model.md)  | Authorization model and RLS design           |
| [Supabase setup](docs/supabase-setup.md)          | Project creation, migrations, auth providers |
| [`.claude/PRD.md`](.claude/PRD.md)                | Product requirements                         |
