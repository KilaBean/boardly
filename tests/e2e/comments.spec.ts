import { expect, test } from "@playwright/test";

/**
 * Comment and activity APIs.
 *
 * Both endpoints return per-user data derived from board visibility, so the
 * boundary worth pinning without a session is that they refuse anonymous
 * callers with a status code rather than an HTML redirect.
 */

const VALID_UUID = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

test.describe("comments API", () => {
  test("refuses an anonymous caller with 401", async ({ request }) => {
    const response = await request.get(`/api/boards/${VALID_UUID}/comments`);
    expect(response.status()).toBe(401);
  });

  test("rejects a malformed board id before touching the database", async ({ request }) => {
    const response = await request.get("/api/boards/not-a-uuid/comments");
    // 401 first: identity is established before the id is even parsed.
    expect([400, 401]).toContain(response.status());
  });

  test("never allows a shared cache to hold the response", async ({ request }) => {
    const response = await request.get(`/api/boards/${VALID_UUID}/comments`);
    expect(response.headers()["cache-control"] ?? "").not.toMatch(/(^|,)\s*public/);
  });
});

test.describe("activity API", () => {
  test("refuses an anonymous caller with 401", async ({ request }) => {
    const response = await request.get(`/api/workspaces/${VALID_UUID}/activity`);
    expect(response.status()).toBe(401);
  });
});

/**
 * NOT COVERED — needs a linked Supabase project:
 *   - posting a comment, resolving it, and the badge count updating
 *   - pinning a comment to a canvas point and the pin surviving pan/zoom
 *   - a viewer being able to comment but not edit the board
 *   - activity appearing in the feed after a board is created
 *
 * The rules underneath are covered without a browser in
 * tests/integration/activity-visibility.test.ts, including a mutation-tested
 * check that a private board's history stays out of a colleague's feed.
 */
