# Supabase setup

What has to happen once, per environment, before Boardly can talk to a real
database. Nothing here is required to run the test suite — the RLS tests boot
their own throwaway Postgres.

## 1. Create the project

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Copy **Project URL**, **anon/publishable key** and **service-role key**
   from _Project Settings → API_.
3. Put them in `.env.local` (see `.env.example`).

The service-role key bypasses every policy in this repository. Treat it like a
database password: server-side only, never in a client component, never in a
log line.

## 2. Apply migrations

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

Migrations live in `supabase/migrations/` and apply in filename order:

| File                                                | Contents                                     |
| --------------------------------------------------- | -------------------------------------------- |
| `20260824000100_initial_schema.sql`                 | Enums, 9 tables, indexes, lifecycle triggers |
| `20260824000200_authorization_helpers.sql`          | `SECURITY DEFINER` permission functions      |
| `20260824000300_row_level_security.sql`             | Column grants + 31 RLS policies              |
| `20260825000100_share_links.sql`                    | Hashed share tokens + column-level grants    |
| `20260825000200_accept_invitation.sql`              | Atomic invitation acceptance                 |
| `20260825000300_service_role_grants.sql`            | DML grants for the admin client              |
| `20260825000400_share_links_side_table.sql`         | Share tokens moved out of `boards`           |
| `20260825000500_boards_select_insert_returning.sql` | Fixes `INSERT ... RETURNING` on boards       |

They are ordinary SQL and are applied verbatim by the test suite, so a
migration that breaks will fail CI before it reaches a database.

### Local stack (optional)

Requires Docker:

```bash
npx supabase start
```

## 3. Regenerate database types

`src/types/database.ts` is hand-maintained until a project is linked. Once it
is, prefer generating it:

```bash
npx supabase gen types typescript --linked > src/types/database.ts
```

## 4. Authentication providers

### Email / password

Enabled by default and already working. Locally, `enable_confirmations = false`
in `supabase/config.toml`, so a new account can sign in immediately — which is
why the E2E seed can create confirmed users directly.

For production, decide whether to require confirmation. If you enable it,
`/auth/callback` already handles both link formats Supabase can send (PKCE
`?code=` and `?token_hash=&type=`), so no application change is needed.

### Password recovery

The app calls `resetPasswordForEmail` with:

```
${NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password
```

`/auth/callback` verifies the link and, for a `recovery` type, sends the user
to `/reset-password` regardless of `next` — a recovery link exists to set a
password, not to land on a dashboard.

**Locally**, recovery needs the mail catcher. Start the stack _without_
excluding `inbucket`:

```bash
supabase start -x storage,imgproxy,studio,analytics,vector,edge-runtime,functions,realtime
```

Mailpit then serves every outgoing email at <http://127.0.0.1:54324> — no real
mail is sent. Note `auth.rate_limit.email_sent` is raised to 100/hour in
`config.toml`; the default of 2 makes recovery impossible to test.

**In production** you must configure SMTP, or Supabase's shared sender will
rate-limit you aggressively and deliverability will be poor. Uncomment
`[auth.email.smtp]` in `config.toml` (or use the dashboard's SMTP settings) and
supply a real provider.

### Google OAuth

Three pieces have to agree. The most common mistake is registering the _app's_
callback in Google Cloud — it must be **Supabase's**.

**1. Create the OAuth client** in
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
_Create Credentials → OAuth client ID → Web application_.

Authorised redirect URI:

| Environment | URI to register                                      |
| ----------- | ---------------------------------------------------- |
| Local       | `http://127.0.0.1:54321/auth/v1/callback`            |
| Hosted      | `https://<project-ref>.supabase.co/auth/v1/callback` |

You will also need to complete the OAuth consent screen. While it is in
"Testing", only accounts listed as test users can sign in.

**2. Give the credentials to Supabase.**

Locally, `supabase/config.toml` already has an `[auth.external.google]` block
that reads them from the environment, so export them before starting:

```bash
export SUPABASE_AUTH_GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
```

```bash
export SUPABASE_AUTH_GOOGLE_SECRET="..."
```

Then restart the stack so the values are picked up. Verify with:

```bash
supabase status
```

For a hosted project, paste the same two values into _Authentication →
Providers → Google_ in the dashboard instead.

**3. Check the redirect allow-list.** The app asks Supabase to send the user
back to `${NEXT_PUBLIC_APP_URL}/auth/callback?next=...`, which must be
permitted. `config.toml` now allows `http://127.0.0.1:3000/**`; for a hosted
project add your production and preview URLs under _Authentication → URL
Configuration_.

No application code changes are required — `signInWithGoogleAction` and
`/auth/callback` already implement the flow.

## 5. Storage

_Storage → Buckets_. Phase 3+ will use:

| Bucket    | Access  | Purpose                   |
| --------- | ------- | ------------------------- |
| `avatars` | public  | Profile images            |
| `boards`  | private | Images placed on a canvas |

Buckets need their own RLS policies; table policies do not cover storage
objects.

## Deploying to a hosted project

The local stack and a hosted project run the **same migrations**; only
configuration differs.

### 1. Link and push

Run these yourself — `link` prompts for the database password, which should not
pass through anyone else's hands:

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

`db push` applies the 8 migrations in `supabase/migrations/` in order. They are
verified from an empty database on every test run (each integration suite boots
a fresh Postgres and applies all of them), so a clean project should take them
without incident.

### 2. Point the app at it

In `.env.local`, replace the local values with the project's own — _Project
Settings → API_:

| Variable                        | Where it comes from                              |
| ------------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project URL                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key                           |
| `SUPABASE_SERVICE_ROLE_KEY`     | service-role key — **server-only, never commit** |
| `NEXT_PUBLIC_APP_URL`           | Your deployed URL                                |

### 3. Configure auth in the dashboard

`supabase/config.toml` governs the **local** stack. A hosted project is
configured through the dashboard, so these have to be set there:

- _Authentication → URL Configuration_: Site URL, plus every production and
  preview URL under redirect allow-list. The app redirects to
  `<APP_URL>/auth/callback`, so a path wildcard (`https://your-app.com/**`) is
  the simplest thing that works.
- _Authentication → Providers → Google_: the client ID and secret, with
  `https://<project-ref>.supabase.co/auth/v1/callback` registered in Google
  Cloud.
- _Project Settings → Auth → SMTP_: **required for production.** Without it,
  password recovery and confirmations go through Supabase's shared sender,
  which is aggressively rate-limited and delivers poorly.

### Local-only settings, for reference

A few values in `config.toml` exist purely to make local testing possible and
should **not** be mirrored to a hosted project:

| Setting                           | Local value                | Why                                                      |
| --------------------------------- | -------------------------- | -------------------------------------------------------- |
| `auth.rate_limit.email_sent`      | `100`                      | The default of 2/hour makes password recovery untestable |
| `auth.email.enable_confirmations` | `false`                    | Lets the E2E seed create ready-to-use accounts           |
| `additional_redirect_urls`        | `http://127.0.0.1:3000/**` | Local origins only                                       |
| `inbucket` / Mailpit              | enabled                    | Catches mail so nothing is really sent                   |

### The test suite cannot touch a hosted project

Two independent guards, because seeding **deletes and recreates users**:

1. Playwright only registers the authenticated projects when
   `NEXT_PUBLIC_SUPABASE_URL` points at `127.0.0.1` or `localhost`. Against a
   hosted URL the authenticated suite is not scheduled at all.
2. `adminClient()` in the seed helper refuses any non-local URL outright unless
   `ALLOW_REMOTE_E2E_SEED=1` is set explicitly.

So pointing `.env.local` at your real project is safe: `npm run test:e2e` will
quietly run only the anonymous suite rather than wiping your users.

## What the schema guarantees

Two triggers keep invariants true regardless of which code path runs:

- `on_auth_user_created` — every auth user gets a `profiles` row immediately,
  so no code has to handle an authenticated user without a profile.
- `on_workspace_created` — the creator is always inserted as the workspace's
  `owner` member.

A unique partial index enforces exactly one owner per workspace.

## Things that are deliberately impossible through the API

These are enforced by column grants, not convention, and hold even for a
crafted request:

- Changing `workspaces.owner_id` or `boards.owner_id`
- Promoting anyone to workspace `owner`
- Updating or deleting an `activity_logs` row
- Updating a `board_snapshots` row
- Reading `invitations.token_hash` as a non-admin
- Any access at all as an unauthenticated (`anon`) caller

See [ADR 0002](adr/0002-authorization-model.md) for the reasoning, and
`tests/integration/rls.test.ts` for the proof.
