import { expect, test } from "@playwright/test";

/**
 * Share links and invitations.
 *
 * `/share/<token>` is the only route in the application reachable without a
 * session, which makes it the one place a mistake is publicly exposed. These
 * tests pin down what an anonymous visitor can and cannot reach.
 */

const NONEXISTENT_TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";

test.describe("public share route", () => {
  test("returns 404 for a token that does not exist", async ({ page }) => {
    const response = await page.goto(`/share/${NONEXISTENT_TOKEN}`);
    expect(response?.status()).toBe(404);
  });

  test("does not redirect anonymous visitors to sign-in", async ({ page }) => {
    // The route must stay public: bouncing to sign-in would make every shared
    // link useless to the people it was shared with.
    await page.goto(`/share/${NONEXISTENT_TOKEN}`);
    expect(page.url()).not.toMatch(/\/sign-in/);
  });

  for (const token of ["../../dashboard", "not a token", "'; drop table boards;--"]) {
    test(`rejects the malformed token ${JSON.stringify(token)}`, async ({ page }) => {
      const response = await page.goto(`/share/${encodeURIComponent(token)}`);
      expect(response?.status()).toBe(404);
    });
  }
});

test.describe("invitation route", () => {
  test("requires sign-in and remembers the invitation", async ({ page }) => {
    // Someone invited by email usually has no account yet, so the link must
    // survive a round trip through sign-up.
    await page.goto(`/invite/${NONEXISTENT_TOKEN}`);

    await expect(page).toHaveURL(/\/sign-in/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(`/invite/${NONEXISTENT_TOKEN}`);
  });
});

/**
 * NOT COVERED — needs a linked Supabase project:
 *   - creating an invitation and accepting it as the invited address
 *   - an invitation rejected because the signed-in email differs
 *   - a share link rendering a real board read-only
 *   - regenerating a link revoking the previous one
 *
 * The rules underneath are exercised without a browser in
 * tests/integration/invitations.test.ts (18 cases, including a mutation-tested
 * email check) and tests/integration/share-links.test.ts.
 */
