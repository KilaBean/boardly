import { expect, test } from "@playwright/test";

/**
 * Auth journeys that do not require a live Supabase project.
 *
 * Route protection, client-side validation and navigation are all enforced by
 * our own code, so they are testable against placeholder credentials. Tests
 * that need a real sign-in are deferred until a Supabase project is linked —
 * see the note at the bottom of this file.
 */

test.describe("route protection", () => {
  test("redirects an unauthenticated visitor away from the dashboard", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("remembers where the visitor was heading", async ({ page }) => {
    await page.goto("/dashboard");

    // The `next` parameter is what returns them to the page after sign-in.
    expect(new URL(page.url()).searchParams.get("next")).toBe("/dashboard");
  });

  test("protects board routes too", async ({ page }) => {
    await page.goto("/board/9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("sign-in page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sign-in");
  });

  test("renders an accessible form", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: /welcome back/i })).toBeVisible();
    // getByLabel only resolves if the label is genuinely associated.
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  test("offers Google sign-in", async ({ page }) => {
    await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  });

  test("reports validation errors without contacting the server", async ({ page }) => {
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByText(/valid email address/i)).toBeVisible();
    // Still on the form, no navigation attempted.
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("marks an invalid field for assistive technology", async ({ page }) => {
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });

  test("is operable by keyboard alone", async ({ page }) => {
    await page.getByLabel("Email").focus();
    await page.keyboard.type("someone@example.com");
    await page.keyboard.press("Tab");
    await page.keyboard.type("a-password");

    await expect(page.getByLabel("Password")).toBeFocused();
  });

  test("links to sign-up and password recovery", async ({ page }) => {
    await page.getByRole("link", { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();

    await page.goto("/sign-in");
    await page.getByRole("link", { name: /^sign up$/i }).click();
    await expect(page).toHaveURL(/\/sign-up/);
  });
});

test.describe("sign-up page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sign-up");
  });

  test("renders every required field", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: /create your account/i }),
    ).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
  });

  test("rejects mismatched passwords on the confirm field", async ({ page }) => {
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password", { exact: true }).fill("longenough1");
    await page.getByLabel("Confirm password").fill("different1");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test("rejects a short password", async ({ page }) => {
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: /create account/i }).click();

    // Scoped to role=alert: the field's helper text ("At least 8 characters.")
    // also matches, and only the error carries the alert role.
    await expect(
      page.getByRole("alert").filter({ hasText: /at least 8 characters/i }),
    ).toBeVisible();
  });
});

test.describe("auth pages load cleanly", () => {
  for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"]) {
    test(`${path} renders without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      expect(errors).toEqual([]);
    });
  }
});

/**
 * NOT COVERED HERE — requires a linked Supabase project with a seeded user:
 *   - completing sign-in and landing on the dashboard
 *   - the `next` parameter actually returning the user to their target page
 *   - sign-out clearing the session
 *   - OAuth and password-recovery round trips
 *
 * These become the first tests to add once credentials exist. The open-redirect
 * defence they would exercise is unit-tested in tests/unit/redirect.test.ts.
 */
