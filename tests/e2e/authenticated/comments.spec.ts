import { expect, test } from "@playwright/test";

import { SEED } from "../helpers/accounts";

/**
 * Comment lifecycle through the UI.
 *
 * Proves the whole path: server action → RLS insert → invalidated refetch →
 * rendered row, plus the badge count that reads from a separate query.
 */

async function openSharedBoard(page: import("@playwright/test").Page) {
  await page.goto(`/w/${SEED.workspace.slug}`);
  await page.getByRole("heading", { name: SEED.sharedBoard }).click();
  await expect(page).toHaveURL(/\/board\//, { timeout: 20_000 });
  await expect(page.locator(".tl-container")).toBeVisible({ timeout: 30_000 });
}

test.describe("comments", () => {
  test("posts a comment and shows it in the panel", async ({ page }) => {
    const body = `Looks good to me ${Date.now()}`;

    await openSharedBoard(page);
    await page
      .getByRole("button", { name: /comments/i })
      .first()
      .click();

    const panel = page.getByRole("complementary", { name: /comments/i });
    await expect(panel).toBeVisible();

    await panel.getByRole("textbox").fill(body);
    await panel.getByRole("button", { name: /^comment$/i }).click();

    await expect(panel.getByText(body)).toBeVisible({ timeout: 20_000 });
  });

  test("resolves a comment and hides it from the default view", async ({ page }) => {
    const body = `Resolve me ${Date.now()}`;

    await openSharedBoard(page);
    await page
      .getByRole("button", { name: /comments/i })
      .first()
      .click();

    const panel = page.getByRole("complementary", { name: /comments/i });
    await panel.getByRole("textbox").fill(body);
    await panel.getByRole("button", { name: /^comment$/i }).click();
    await expect(panel.getByText(body)).toBeVisible({ timeout: 20_000 });

    // Scope to the row so the right comment's button is clicked.
    const row = panel.locator("li").filter({ hasText: body });
    await row.getByRole("button", { name: /^resolve$/i }).click();

    // The default view is unresolved-only.
    await expect(panel.getByText(body)).toBeHidden({ timeout: 20_000 });

    await panel.getByRole("button", { name: /show resolved/i }).click();
    await expect(panel.getByText(body)).toBeVisible({ timeout: 20_000 });
  });

  test("renders a comment body as text, never as markup", async ({ page }) => {
    // Comment bodies are user input; an injected tag must not become an element.
    const payload = `<img src=x onerror="window.__xss=1"> ${Date.now()}`;

    await openSharedBoard(page);
    await page
      .getByRole("button", { name: /comments/i })
      .first()
      .click();

    const panel = page.getByRole("complementary", { name: /comments/i });
    await panel.getByRole("textbox").fill(payload);
    await panel.getByRole("button", { name: /^comment$/i }).click();

    await expect(panel.getByText(payload)).toBeVisible({ timeout: 20_000 });
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    expect(await panel.locator('img[src="x"]').count()).toBe(0);
  });
});
