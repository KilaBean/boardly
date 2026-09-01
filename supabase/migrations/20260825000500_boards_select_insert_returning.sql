-- ============================================================================
-- Boardly — fix INSERT ... RETURNING on boards
--
-- THE BUG
--
-- `createBoardAction` runs `.insert(...).select("id")`, which PostgREST issues
-- as `INSERT ... RETURNING`. RETURNING must satisfy the SELECT policy as well
-- as the INSERT policy.
--
-- `boards_select` used `can_view_board(id)`, which calls `board_access_role()`
-- — a STABLE function that re-reads `public.boards` to find the row. A STABLE
-- function uses the snapshot taken at statement start, so the row being
-- inserted is not visible to it. The check therefore returned NULL, the
-- SELECT policy failed, and Postgres reported:
--
--     new row violates row-level security policy for table "boards"
--
-- Net effect: **creating a board failed for every user**, while the identical
-- INSERT without RETURNING succeeded.
--
-- WHY NOTHING CAUGHT IT
--
-- The RLS integration suite inserts boards either as the superuser or without
-- RETURNING, so the combination that the application actually uses was never
-- exercised. Only running the E2E suite against a real Supabase stack, where
-- PostgREST always adds RETURNING, surfaced it.
--
-- THE FIX
--
-- Give the policy a direct-ownership branch that reads `owner_id` straight off
-- the row under evaluation instead of going back to the table. This is exactly
-- the shape `workspaces_select` already uses, and for exactly this reason — the
-- lesson was applied there and missed here.
--
-- Making `board_access_role()` VOLATILE would also work, but it is called on
-- every board read; volatile functions cannot be cached or inlined, so that
-- would trade a correctness bug for a performance one.
-- ============================================================================

drop policy boards_select on public.boards;

create policy boards_select on public.boards
  for select to authenticated
  using (
    -- Evaluated against the row itself, so it holds during INSERT ... RETURNING
    -- before the row is visible to a snapshot-bound function.
    owner_id = (select auth.uid())
    or public.can_view_board(id)
  );

-- Note this widens nothing: `board_access_role()` already resolves the owner
-- to 'editor', so any board matched by the new branch was already visible.
-- The branch only changes *when* that answer can be computed.
