import { expect, test } from "@playwright/test";

import { SEED } from "../helpers/accounts";

/**
 * The core authenticated journey: a signed-in owner working with boards.
 *
 * These are the tests that eight phases of unit and integration work could not
 * replace — everything here crosses the browser, the server action, RLS and
 * back, which is exactly the seam that was never exercised.
 */

test.describe("workspace dashboard", () => {
  test("lands on the seeded workspace", async ({ page }) => {
    await page.goto("/dashboard");

    // /dashboard is a router: with one workspace it redirects into it.
    await expect(page).toHaveURL(new RegExp(`/w/${SEED.workspace.slug}`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEED.workspace.name);
  });

  test("lists the boards the owner can see", async ({ page }) => {
    await page.goto(`/w/${SEED.workspace.slug}`);

    await expect(page.getByRole("heading", { name: SEED.sharedBoard })).toBeVisible();
    // The owner can see their own private board.
    await expect(page.getByRole("heading", { name: SEED.privateBoard })).toBeVisible();
  });

  test("shows recent activity for the workspace", async ({ page }) => {
    await page.goto(`/w/${SEED.workspace.slug}`);

    const activity = page.getByRole("region", { name: /recent activity/i });
    await expect(activity).toBeVisible();
  });
});

test.describe("board lifecycle", () => {
  test("creates a board and opens it", async ({ page }) => {
    const name = `Created ${Date.now()}`;

    await page.goto(`/w/${SEED.workspace.slug}`);
    await page.getByRole("button", { name: /new board/i }).click();

    await page.getByLabel("Board name").fill(name);
    await page.getByRole("button", { name: /^create board$/i }).click();

    // Creating a board navigates straight into it.
    await expect(page).toHaveURL(/\/board\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  });

  test("renames a board from the dashboard", async ({ page }) => {
    const original = `Rename me ${Date.now()}`;
    const renamed = `${original} (renamed)`;

    // Arrange through the UI so the test exercises creation too.
    await page.goto(`/w/${SEED.workspace.slug}`);
    await page.getByRole("button", { name: /new board/i }).click();
    await page.getByLabel("Board name").fill(original);
    await page.getByRole("button", { name: /^create board$/i }).click();
    await expect(page).toHaveURL(/\/board\//, { timeout: 20_000 });

    await page.goto(`/w/${SEED.workspace.slug}`);
    await page.getByRole("button", { name: `Board options for ${original}` }).click();
    await page.getByRole("menuitem", { name: /rename/i }).click();

    await page.getByLabel("Board name").fill(renamed);
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByRole("heading", { name: renamed })).toBeVisible({ timeout: 15_000 });
  });

  test("archives a board, removing it from the list", async ({ page }) => {
    const name = `Archive me ${Date.now()}`;

    await page.goto(`/w/${SEED.workspace.slug}`);
    await page.getByRole("button", { name: /new board/i }).click();
    await page.getByLabel("Board name").fill(name);
    await page.getByRole("button", { name: /^create board$/i }).click();
    await expect(page).toHaveURL(/\/board\//, { timeout: 20_000 });

    await page.goto(`/w/${SEED.workspace.slug}`);
    await page.getByRole("button", { name: `Board options for ${name}` }).click();
    await page.getByRole("menuitem", { name: /archive/i }).click();

    // Optimistic removal, then the invalidated refetch confirms it.
    await expect(page.getByRole("heading", { name })).toBeHidden({ timeout: 15_000 });
  });
});

test.describe("board canvas", () => {
  test("opens the canvas with editing enabled for the owner", async ({ page }) => {
    await page.goto(`/w/${SEED.workspace.slug}`);
    await page.getByRole("heading", { name: SEED.sharedBoard }).click();

    await expect(page).toHaveURL(/\/board\//, { timeout: 20_000 });

    // tldraw mounts client-side, so this also proves the dynamic import works.
    await expect(page.locator(".tl-container")).toBeVisible({ timeout: 30_000 });

    // An editor sees no "View only" badge.
    await expect(page.getByText(/view only/i)).toBeHidden();
  });
});
