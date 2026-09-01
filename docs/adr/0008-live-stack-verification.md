# ADR 0008 — Running against a live stack, and what it found

- **Status:** Accepted
- **Date:** 2026-08-25
- **Phase:** Verification

## Context

Seven phases accumulated the same documented gap: authenticated journeys were
never executed. Sign-in, board CRUD, comments, invitations and share links were
covered by unit and integration tests, but nothing had ever driven them through
a browser against a real auth server.

This phase closed that gap and, in doing so, found **four production-breaking
bugs that every prior test had passed over**.

## How the environment was provisioned

A **local Supabase stack** (`supabase start`) rather than a hosted project.
The CLI was already authenticated, so creating a cloud project was possible —
but local was chosen deliberately: it needs no database password handled in
plaintext, creates no billable resource, and provides the same GoTrue auth
server, PostgREST and RLS engine.

Storage, Studio, analytics, realtime and edge-runtime are excluded (`-x`); the
app uses none of them, and the storage container failed its health check on
this machine, which rolled back the whole stack. **Mailpit is deliberately
kept**, because password recovery cannot be tested without somewhere for the
email to land.

The Playwright config **enables the authenticated projects only when a local
Supabase is configured**, so `npm run test:e2e` still passes on a machine
without Docker — it runs the anonymous suite alone. `E2E_REQUIRE_AUTH=1` turns
that graceful skip into an error for CI.

Liveblocks has no local emulator, so its keys had to be supplied. Once they
were, live collaboration was verified too — see below.

## The bugs

### 1. `service_role` had no privileges on any table

Current Supabase default privileges grant **no DML** on new `public` tables to
`anon`, `authenticated` _or_ `service_role` — confirmed with a probe table the
migrations never touched. The migrations granted `authenticated` what it
needed and never granted `service_role` anything.

`resolveShareToken()` reads through the admin client, so **every share link
would have 404ed in production**, and enabling or rotating one would have
failed.

Invisible to the integration suite because it seeds as the _superuser_
(`asAdmin`), which sees no grant errors. The test harness gained an
`asServiceRole()` and a suite that runs as the real role.

### 2. Column-level grants broke `count(*)`

Phase 7 hid `boards.share_token_hash` by replacing the table-level SELECT grant
with column-level grants. Postgres requires **table-level** SELECT for
`count(*)`, so `listWorkspaces()` — which embeds `boards(count)` — failed with
`permission denied for table boards`.

The application swallowed the error and returned an empty array, so **every
signed-in user was redirected to onboarding as though they had no
workspaces**.

Fixed by moving the token to its own `board_share_links` table, which no API
role can read at all. `boards` returns to an ordinary table-level grant
governed by RLS, and a trigger keeps `share_link_enabled` truthful — enabling
sharing means creating a link, so the flag can no longer drift.

Column grants on a heavily-queried table were the wrong tool: they also break
`select *` and any future aggregate.

### 3. `INSERT ... RETURNING` failed under the boards SELECT policy

`RETURNING` must satisfy the SELECT policy as well as the INSERT policy.
`boards_select` called `can_view_board(id)` → `board_access_role()`, a
**STABLE** function that re-reads `boards`. A STABLE function uses the snapshot
from statement start, so the row being inserted is invisible to it.

`createBoardAction` runs `.insert(...).select("id")`, which PostgREST issues as
`INSERT ... RETURNING`. **Creating a board failed for every user**, while the
identical INSERT without RETURNING succeeded.

Fixed by giving the policy a direct-ownership branch —
`owner_id = (select auth.uid()) or public.can_view_board(id)` — that reads the
row under evaluation rather than going back to the table. This is precisely
the shape `workspaces_select` already used, for exactly this reason: the lesson
had been applied there and missed here.

Making `board_access_role()` VOLATILE would also work but would trade a
correctness bug for a performance one, since it is called on every board read.

### 4. Auth redirects jumped origin and dropped the session

`/auth/callback` built its redirect from `request.nextUrl.origin`. That does
**not** reflect the incoming Host: a request to `127.0.0.1:3000` produced a
redirect to `localhost:3000`. `request.url` turned out to be normalised the
same way inside a route handler, so switching to it changed nothing.

This is the response that sets the session cookies, and cookies are scoped to a
host — so the user was redirected to an origin their brand-new session did not
cover. It surfaced as **"Your reset link has expired" immediately after
following a perfectly valid recovery link**, and would have done the same to
every Google OAuth sign-in.

Fixed by emitting a **relative** `Location` (RFC 7231 §7.1.2 permits it), which
the browser resolves against whatever host the user is actually on. `proxy.ts`
was building redirects the same way and is fixed to match.

Only reachable with a real auth server issuing real redirects, which is why
seven phases of tests never saw it.

## Test defects found in my own suite

Worth recording separately, because two were not product bugs:

- **Global sign-out.** `supabase.auth.signOut()` defaults to _global_ scope,
  revoking every refresh token the user holds. The sign-out test shared an
  account with other workers, so it invalidated their cached sessions
  mid-run — 13 failures from one test. It now has a dedicated account.
- **Shared mutable fixture.** Three share-link tests toggled the _same_ board's
  link in parallel and revoked each other's work. Each now creates its own
  board.

## Real UI defects found

- **Board options menu stayed open behind its dialog.** `preventDefault()` on a
  menu item keeps the menu mounted; a mounted Radix menu is a modal overlay
  that hides the rest of the page from assistive technology. The menu is now
  controlled and closes when a dialog opens.
- **"Show resolved" showed stale comments.** `useComments` supplied
  `initialData` for _every_ query key, so toggling the filter seeded the new
  key with the server's unresolved-only page. `initialData` counts as fresh, so
  with `staleTime: 60_000` the resolved view never refetched for a minute.
  Seeding is now scoped to the view the server actually rendered.

## Verification

- **433 Vitest tests** (276 unit, 157 integration) and **78 Playwright specs**,
  all passing against live Supabase and live Liveblocks.
- Every bug above is covered by a regression test, and the two SQL fixes were
  **mutation tested**: removing migration 300 fails 5 service-role tests;
  removing migration 500 fails 3 `INSERT ... RETURNING` tests.
- The authenticated suite covers sign-in for three accounts, board create /
  rename / archive, canvas mount, tenant isolation (a workspace member cannot
  see a private board), viewer read-only enforcement, sign-out, the `?next=`
  round trip, comment post / resolve / XSS-as-text, invitation accept and
  email-mismatch refusal, and share-link create / rotate / revoke including an
  anonymous visitor.
- **Live collaboration**, once Liveblocks keys were supplied: two browser
  contexts join the same room, each sees the other's presence, and **a shape
  drawn by one appears for the other**. Room authorization is exercised against
  the live endpoint — a board member receives a token, a non-member gets 403 —
  which finally proves the architecture's central invariant end to end.

  One technique worth recording: drawing must use `page.mouse`, not
  synthetic `dispatchEvent` pointer events. Only the former produces trusted
  events that honour pointer capture, which is why an earlier manual attempt
  to verify the canvas produced no shapes.

- **Password recovery**, end to end through a real email: the reset is
  requested, the message is read out of Mailpit, the link is followed, a new
  password is set, and the user lands signed in. A follow-up test proves the
  old password stops working and the new one starts, and a third proves the
  form does not reveal whether an address has an account.

## Known gaps

- **Google OAuth is configured but not exercised.** `supabase/config.toml` now
  has an `[auth.external.google]` block reading credentials from the
  environment, and `docs/supabase-setup.md` documents the three-way setup —
  but verifying it needs a Google Cloud OAuth client, which only the project
  owner can create. The code path is shared with the recovery flow that is now
  proven, including the redirect fix above.
- The suite depends on Docker being up. It skips cleanly when absent, which is
  convenient but means a green local run does not prove the authenticated layer
  ran — hence `E2E_REQUIRE_AUTH=1` for CI.
