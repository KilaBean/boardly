import { expect, test } from "@playwright/test";

import { SEED, storageStatePath } from "../helpers/accounts";

/**
 * Tenant isolation, proven through the browser.
 *
 * RLS is tested directly against Postgres in `tests/integration/rls.test.ts`,
 * but that proves the policies deny SQL — not that the application actually
 * queries as the user. A page that used the service role by mistake would
 * pass every integration test and fail here.
 */

test.describe("as a workspace member", () => {
  test.use({ storageState: storageStatePath("collaborator") });

  test("sees the workspace and its shared board", async ({ page }) => {
    await page.goto(`/w/${SEED.workspace.slug}`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEED.workspace.name);
    await expect(page.getByRole("heading", { name: SEED.sharedBoard })).toBeVisible();
  });

  test("does NOT see the owner's private board", async ({ page }) => {
    // The headline isolation guarantee: workspace membership is not board access.
    await page.goto(`/w/${SEED.workspace.slug}`);

    await expect(page.getByRole("heading", { name: SEED.sharedBoard })).toBeVisible();
    await expect(page.getByRole("heading", { name: SEED.privateBoard })).toBeHidden();
  });

  test("gets view-only access on a board shared with them as viewer", async ({ page }) => {
    await page.goto(`/w/${SEED.workspace.slug}`);
    await page.getByRole("heading", { name: "Read Only For Casey" }).click();

    await expect(page).toHaveURL(/\/board\//, { timeout: 20_000 });
    // An explicit viewer grant overrides the workspace-wide editor default.
    await expect(page.getByText(/view only/i)).toBeVisible({ timeout: 20_000 });
  });

  test("cannot manage a board they do not own", async ({ page }) => {
    await page.goto(`/w/${SEED.workspace.slug}`);
    // The options menu is owner-only, so it is absent entirely.
    await expect(
      page.getByRole("button", { name: `Board options for ${SEED.sharedBoard}` }),
    ).toBeHidden();
  });
});

test.describe("as somebody outside the workspace", () => {
  test.use({ storageState: storageStatePath("outsider") });

  test("is sent to onboarding, having no workspaces", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole("heading", { name: /create your first workspace/i })).toBeVisible();
  });

  test("gets a 404 for a workspace they do not belong to", async ({ page }) => {
    // Not a 403: telling them the workspace exists would itself be a leak.
    const response = await page.goto(`/w/${SEED.workspace.slug}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("session handling", () => {
  // A dedicated account: signing out revokes every refresh token the user
  // holds, which would break the other workers sharing an account.
  test.use({ storageState: storageStatePath("quitter") });

  test("signing out ends the session and protects the dashboard again", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/w\//, { timeout: 20_000 });

    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();

    await expect(page).toHaveURL(/\/sign-in/, { timeout: 20_000 });

    // The cookie is genuinely gone, not merely redirected away from.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("returns the user to where they were headed after signing in", async ({ page }) => {
    // Exercises the ?next= round trip that safeRedirectPath guards.
    await page.context().clearCookies();

    await page.goto(`/w/${SEED.workspace.slug}`);
    await expect(page).toHaveURL(/\/sign-in/);

    const { ACCOUNTS, TEST_PASSWORD } = await import("../helpers/accounts");
    await page.getByLabel("Email").fill(ACCOUNTS.owner.email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(new RegExp(`/w/${SEED.workspace.slug}`), { timeout: 20_000 });
  });
});
