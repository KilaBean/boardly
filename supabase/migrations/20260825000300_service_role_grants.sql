-- ============================================================================
-- Boardly — service-role table grants
--
-- WHY THIS EXISTS
--
-- Current Supabase default privileges grant NO DML on new `public` tables to
-- `anon`, `authenticated` or `service_role` — verified against a real stack:
-- a freshly created table shows only REFERENCES/TRIGGER/TRUNCATE for all
-- three. Every privilege has to be granted deliberately.
--
-- The earlier migrations did that for `authenticated` but never for
-- `service_role`, which left the admin client with no access to anything. The
-- consequence was not theoretical: `resolveShareToken()` reads `boards` and
-- `board_snapshots` through the service role, so **every share link would have
-- 404ed in production**, and enabling or rotating a link would have failed.
--
-- This was invisible to the PGlite integration suite because those tests seed
-- as the superuser rather than as `service_role`. `tests/integration/
-- service-role.test.ts` now exercises the real role so it cannot regress.
--
-- WHY FULL DML IS APPROPRIATE HERE
--
-- `service_role` is the trusted backend identity and already bypasses RLS.
-- Withholding table grants from it adds no security — anyone holding the
-- service key can act freely regardless — while producing confusing runtime
-- failures. The security boundary for this role is "never let the key reach a
-- browser", which `server-only` enforces at build time.
-- ============================================================================

grant select, insert, update, delete on all tables in schema public to service_role;

-- Applies to tables added by later migrations, so this does not have to be
-- remembered every time.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- Deliberately NOT granted to `anon`: unauthenticated callers must continue to
-- have no access to any table. Public share links are served by a server route
-- using the service role, never by relaxing anon's privileges.
