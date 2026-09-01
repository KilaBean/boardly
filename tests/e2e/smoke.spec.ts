import { expect, test } from "@playwright/test";

test.describe("foundation smoke", () => {
  test("renders the Boardly foundation page", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /change theme/i })).toBeVisible();
  });

  test("loads without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("switches to the dark theme", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /change theme/i }).click();
    await page.getByRole("menuitem", { name: "Dark" }).click();

    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
