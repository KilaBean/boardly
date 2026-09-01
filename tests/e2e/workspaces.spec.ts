import { expect, test } from "@playwright/test";

/**
 * Workspace and board routes.
 *
 * Without a linked Supabase project there is no way to establish a session, so
 * these cover the boundary that does not need one: every new route must refuse
 * anonymous access, and the API must refuse it with a status code rather than
 * a redirect.
 */

const VALID_UUID = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

test.describe("protected routes reject anonymous visitors", () => {
  for (const path of [
    "/dashboard",
    "/onboarding",
    "/w/acme",
    `/board/${VALID_UUID}`,
    "/w/some-other-workspace",
  ]) {
    test(`${path} redirects to sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
    });
  }

  test("preserves the intended destination", async ({ page }) => {
    await page.goto("/w/acme");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/w/acme");
  });
});

test.describe("boards API", () => {
  test("returns 401 rather than redirecting", async ({ request }) => {
    // An API route must fail with a status a client can branch on. A 3xx to an
    // HTML sign-in page would surface as a confusing JSON parse error.
    const response = await request.get(`/api/workspaces/${VALID_UUID}/boards`);
    expect(response.status()).toBe(401);
  });

  test("never caches per-user data in a shared cache", async ({ request }) => {
    const response = await request.get(`/api/workspaces/${VALID_UUID}/boards`);
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl).not.toMatch(/(^|,)\s*public/);
  });
});

/**
 * NOT COVERED — needs a linked Supabase project with a seeded user:
 *   - onboarding creating the first workspace and redirecting into it
 *   - creating, renaming, archiving and deleting a board
 *   - optimistic updates rolling back when the server rejects a mutation
 *   - the workspace switcher moving between workspaces
 *
 * The rules underneath are covered without a browser: slug generation against
 * the real CHECK constraints (tests/integration/slug-constraints.test.ts) and
 * board permissions against the real policies (tests/integration/rls.test.ts).
 */
