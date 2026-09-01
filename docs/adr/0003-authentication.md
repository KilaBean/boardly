# ADR 0003 — Authentication architecture

- **Status:** Accepted
- **Date:** 2026-08-24
- **Phase:** 3 (Authentication)

## Context

Boardly uses Supabase Auth with email/password and Google OAuth. The
interesting decisions are not "which provider" but where the authoritative
check lives, and how the auth surface avoids leaking information.

## Decisions

### 1. `proxy.ts`, not `middleware.ts`

Next.js 16 **deprecated the `middleware` file convention and renamed it to
`proxy`**, including the exported function name
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).

Every Supabase SSR tutorial still says `middleware.ts`. Following them would
have shipped a deprecated convention on day one, so `src/proxy.ts` exports
`proxy()` instead. Behaviour is identical; only the names changed.

### 2. Two-layer auth: optimistic proxy, authoritative DAL

Next.js explicitly warns that Proxy runs on every request _including
prefetches_, so it must stay cheap and must not hit the database. It is also
not a security boundary.

| Layer | Where                  | Does what                                                          | Trustworthy?     |
| ----- | ---------------------- | ------------------------------------------------------------------ | ---------------- |
| Proxy | `src/proxy.ts`         | Refreshes session cookies; redirects unauthenticated visitors      | **No** — UX only |
| DAL   | `src/lib/auth/dal.ts`  | `getUser()` / `requireUser()`, revalidated against the auth server | Yes              |
| RLS   | `supabase/migrations/` | Row-level authorization                                            | Yes — last line  |

**If `src/proxy.ts` were deleted, nothing would leak.** Pages would render and
then redirect, and RLS would still refuse the data. That is the property we
want from an optimistic layer.

### 3. `getUser()`, never `getSession()`, on the server

`getSession()` reads the auth cookie and trusts its contents. `getUser()`
revalidates the token with the Supabase Auth server.

On the server the cookie is attacker-supplied input, so this is the difference
between a real check and a decorative one. The DAL only ever calls
`getUser()`, and every function is wrapped in React's `cache` so a layout plus
three components cost one verification per render, not four.

### 4. Uniform responses to avoid account enumeration

A sign-in form that says "no account with that email" is an oracle: it lets an
attacker turn a breach dump into a verified list of your users, which is the
setup for credential stuffing and targeted phishing.

So:

- Wrong password and unknown account both return **"Incorrect email or password."**
- Password reset **always** reports "If an account exists for that address, a
  reset link is on its way", and the underlying Supabase result is ignored.
- Sign-up with an already-registered address produces the same "check your
  email" screen as a genuinely new one. (Supabase itself returns a user with
  no identities rather than an error in this case.)

The one deliberate exception is `email_not_confirmed` on sign-in: the visitor
has already proven they know the password, so it reveals nothing to an
outsider and withholding it would be baffling.

### 5. `?next=` is validated, not trusted

Sign-in carries a return path. Unvalidated, `/sign-in?next=https://evil.example`
is a covert redirect from our own domain — the victim sees a legitimate origin
right up until they are handed to the attacker.

`safeRedirectPath()` allows only path-absolute, same-origin targets. It
rejects absolute URLs, scheme-relative `//host` (absolute in browsers),
backslash smuggling `/\host` and its percent-encodings, and control characters
that enable header injection. It is applied in the proxy, the DAL, the sign-in
action and the OAuth callback — every place a redirect target crosses a trust
boundary.

25 unit tests cover it, because this is the kind of check that looks correct
and is subtly wrong.

### 6. Auth callback handles both link formats

`/auth/callback` accepts PKCE (`?code=`) _and_ token-hash (`?token_hash=&type=`)
flows. Which one Supabase sends depends on project email-template settings,
and a mismatch presents as "clicking the email link does nothing" — an
expensive thing to debug. Supporting both removes the failure mode.

A `recovery` link routes to `/reset-password` rather than the dashboard, since
its only purpose is choosing a new password.

### 7. Passwords: length only, no composition rules

Minimum 8, maximum 72 (the bcrypt input limit). No "must contain a symbol"
rule — NIST SP 800-63B advises against composition rules because they push
people toward predictable substitutions and shorter passwords.

`signInSchema` deliberately does **not** apply the policy: an account created
under an older policy must still be able to sign in, and validating length on
the sign-in form would lock users out of their own accounts.

### 8. A DTO crosses into client components, not the Supabase user

`getCurrentUser()` returns `{ id, email, displayName, avatarUrl }`. Passing the
raw Supabase user object would ship `app_metadata`, `identities` and raw
provider payloads into the browser for no reason.

## Verification

- **183 Vitest tests pass** (111 unit, 72 integration) plus 19 Playwright specs.
- E2E proves `/dashboard` and `/board/*` redirect unauthenticated visitors and
  preserve `?next=`, that form validation and `aria-invalid` work, that the
  forms are keyboard operable, and that all four auth pages load with **zero
  console errors**.
- The built client bundle was grepped for the service-role and Liveblocks
  secret values: **neither appears in `.next/static`**.

## Known gaps

- Sign-in success, sign-out, OAuth and recovery round trips are not E2E
  tested, because they need a linked Supabase project with a seeded user.
  `tests/e2e/auth.spec.ts` documents these as the first tests to add.
- Rate limiting relies on Supabase's built-in limits. The PRD asks for
  application-level limits on sensitive endpoints; that belongs with
  invitations in Phase 5.
- "Profile settings" is present but disabled in the user menu.
