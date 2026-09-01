import { expect, test } from "@playwright/test";

import { ACCOUNTS, RESET_PASSWORD, TEST_PASSWORD } from "../helpers/accounts";
import { clearMailbox, firstLink, waitForEmail } from "../helpers/mail";

/**
 * Password recovery, end to end through a real email.
 *
 * Runs unauthenticated despite living beside the authenticated specs, because
 * it needs the local Supabase stack (for GoTrue and Mailpit) that gates this
 * project. Recovery is precisely the flow nobody exercises until it is broken
 * for a real user who has locked themselves out.
 */

// Starts signed out: recovery is for people who cannot get in.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("password recovery", () => {
  // Serial: the second test asserts on the password the first one sets. Under
  // `fullyParallel` these would otherwise race into different workers, and the
  // verification could run before the reset it verifies.
  test.describe.configure({ mode: "serial" });

  // A real email round trip plus two sign-ins.
  test.setTimeout(120_000);

  test("a reset link lets the user choose a new password and signs them in", async ({ page }) => {
    await clearMailbox();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(ACCOUNTS.resetter.email);
    await page.getByRole("button", { name: /send reset link/i }).click();

    // The response is deliberately identical whether or not the account
    // exists, so the confirmation screen proves nothing on its own.
    await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible({
      timeout: 20_000,
    });

    const body = await waitForEmail(ACCOUNTS.resetter.email);
    const link = firstLink(body);

    // Following the link consumes the token and lands on the reset form.
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /choose a new password/i })).toBeVisible();

    // exact: true — "New password" is a substring of "Confirm new password".
    await page.getByLabel("New password", { exact: true }).fill(RESET_PASSWORD);
    await page.getByLabel("Confirm new password").fill(RESET_PASSWORD);
    await page.getByRole("button", { name: /update password/i }).click();

    // Updating the password signs the user straight in.
    await expect(page).toHaveURL(/\/(dashboard|w\/)/, { timeout: 30_000 });
  });

  test("the new password works and the old one does not", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(ACCOUNTS.resetter.email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // Matched by text, not role: Next renders its own role="alert" route
    // announcer, which makes getByRole("alert") ambiguous.
    await expect(page.getByText(/incorrect email or password/i)).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel("Password").fill(RESET_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/(dashboard|w\/)/, { timeout: 30_000 });
  });

  test("does not reveal whether an address has an account", async ({ page }) => {
    // The anti-enumeration property: an unknown address gets the same screen.
    await clearMailbox();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("definitely-not-registered@boardly.test");
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible({
      timeout: 20_000,
    });
  });
});
