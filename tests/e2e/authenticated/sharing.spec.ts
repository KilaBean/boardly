import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, SEED, storageStatePath } from "../helpers/accounts";

/**
 * Invitations and share links, end to end across accounts.
 *
 * These are the journeys that most needed a real stack: an invitation is
 * created by one user, carried on a URL, and consumed by a different signed-in
 * user, with a database function deciding whether it is allowed. Nothing short
 * of two real sessions exercises that.
 */

async function openSharedBoard(page: Page) {
  await page.goto(`/w/${SEED.workspace.slug}`);
  await page.getByRole("heading", { name: SEED.sharedBoard }).click();
  await expect(page).toHaveURL(/\/board\//, { timeout: 20_000 });
}

/**
 * Creates a board and opens it.
 *
 * Share-link tests each need their own board: a link is per-board, and three
 * tests toggling one board's link in parallel revoke each other's work.
 */
async function createOwnBoard(page: Page, name: string) {
  await page.goto(`/w/${SEED.workspace.slug}`);
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByLabel("Board name").fill(name);
  await page.getByRole("button", { name: /^create board$/i }).click();
  await expect(page).toHaveURL(/\/board\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

/** Reads the one-time URL out of the dialog's copy field. */
async function readLinkValue(page: Page): Promise<string> {
  const field = page.getByLabel("Invitation link");
  await expect(field).toBeVisible({ timeout: 20_000 });
  return (await field.inputValue()).trim();
}

test.describe("invitations", () => {
  test("an invited user can accept and gain access", async ({ page, browser }) => {
    await openSharedBoard(page);
    await page.getByRole("button", { name: /^share$/i }).click();

    await page.getByLabel("Invite by email").fill(ACCOUNTS.outsider.email);
    await page.getByLabel("Access level").selectOption("viewer");
    await page.getByRole("button", { name: /^invite$/i }).click();

    const inviteUrl = await readLinkValue(page);
    expect(inviteUrl).toContain("/invite/");

    // A second session, signed in as the invited person.
    const context = await browser.newContext({
      storageState: storageStatePath("outsider"),
    });
    const invitee = await context.newPage();

    await invitee.goto(inviteUrl);

    // Acceptance redirects straight into the board it granted access to.
    await expect(invitee).toHaveURL(/\/board\//, { timeout: 30_000 });
    await expect(invitee.getByText(/view only/i)).toBeVisible({ timeout: 20_000 });

    await context.close();
  });

  test("an invitation addressed to somebody else is refused", async ({ page, browser }) => {
    // The security property: an invitation is addressed to a person, not to
    // whoever holds the link.
    await openSharedBoard(page);
    await page.getByRole("button", { name: /^share$/i }).click();

    await page.getByLabel("Invite by email").fill("nobody-else@boardly.test");
    await page.getByRole("button", { name: /^invite$/i }).click();

    const inviteUrl = await readLinkValue(page);

    const context = await browser.newContext({
      storageState: storageStatePath("collaborator"),
    });
    const wrongPerson = await context.newPage();

    await wrongPerson.goto(inviteUrl);

    await expect(wrongPerson.getByText(/different email address/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(wrongPerson).not.toHaveURL(/\/board\//);

    await context.close();
  });
});

test.describe("share links", () => {
  test("a created link opens the board read-only for an anonymous visitor", async ({
    page,
    browser,
  }) => {
    const boardName = `Share target ${Date.now()}`;
    await createOwnBoard(page, boardName);
    await page.getByRole("button", { name: /^share$/i }).click();

    await page.getByRole("button", { name: /create link/i }).click();

    const shareUrl = await readLinkValue(page);
    expect(shareUrl).toContain("/share/");

    // No storage state at all: a genuinely anonymous visitor.
    const context = await browser.newContext();
    const visitor = await context.newPage();

    await visitor.goto(shareUrl);

    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(boardName);
    await expect(visitor.getByText(/view only/i)).toBeVisible();
    // Never bounced to sign-in: this is the one public route.
    expect(visitor.url()).not.toMatch(/\/sign-in/);

    await context.close();
  });

  test("regenerating a link revokes the previous one", async ({ page, browser }) => {
    await createOwnBoard(page, `Rotate target ${Date.now()}`);
    await page.getByRole("button", { name: /^share$/i }).click();

    const createOrRegenerate = page.getByRole("button", { name: /create link|regenerate/i });
    await createOrRegenerate.click();
    const firstUrl = await readLinkValue(page);

    await page.getByRole("button", { name: /regenerate/i }).click();
    // Wait for a different value before asserting on the old one.
    await expect.poll(async () => readLinkValue(page), { timeout: 20_000 }).not.toBe(firstUrl);

    const context = await browser.newContext();
    const visitor = await context.newPage();

    // Rotation is the revocation mechanism, so the old URL must be dead.
    const response = await visitor.goto(firstUrl);
    expect(response?.status()).toBe(404);

    await context.close();
  });

  test("turning sharing off kills the link", async ({ page, browser }) => {
    await createOwnBoard(page, `Revoke target ${Date.now()}`);
    await page.getByRole("button", { name: /^share$/i }).click();

    await page.getByRole("button", { name: /create link|regenerate/i }).click();
    const url = await readLinkValue(page);

    await page.getByRole("button", { name: /turn off/i }).click();

    // Wait for the dialog to reflect the change before probing the URL: the
    // click returns as soon as the transition starts, so navigating straight
    // away can beat the server action and find the link still live.
    await expect(page.getByRole("button", { name: /turn off/i })).toBeHidden({
      timeout: 30_000,
    });

    const context = await browser.newContext();
    const visitor = await context.newPage();

    const response = await visitor.goto(url);
    expect(response?.status()).toBe(404);

    await context.close();
  });
});
