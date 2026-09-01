import { expect, test as setup } from "@playwright/test";

import { ACCOUNTS, storageStatePath, TEST_PASSWORD, type AccountKey } from "../helpers/accounts";
import { loadEnvLocal } from "../helpers/env";

loadEnvLocal();

/**
 * Signs each account in through the real UI and caches the session.
 *
 * Deliberately not a shortcut that injects a token: this is the first
 * automated proof that sign-in actually works end to end — the form, the
 * server action, the Supabase session, the cookie, and the redirect. Every
 * later authenticated test then reuses the cached state instead of paying for
 * a sign-in it is not testing.
 */
for (const account of Object.keys(ACCOUNTS) as AccountKey[]) {
  setup(`authenticate as ${account}`, async ({ page }) => {
    await page.goto("/sign-in");

    await page.getByLabel("Email").fill(ACCOUNTS[account].email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // Landing anywhere under the authenticated shell proves the session stuck.
    await expect(page).toHaveURL(/\/(dashboard|w\/|onboarding)/, { timeout: 20_000 });

    await page.context().storageState({ path: storageStatePath(account) });
  });
}
