import { expect, test } from "@playwright/test";

/**
 * Liveblocks room authorization.
 *
 * A Liveblocks access token bypasses Postgres once issued, so this endpoint is
 * the last place permissions are checked. Without a session there is nothing
 * it should ever hand out — including to a caller who guesses a valid room
 * name.
 */

const VALID_UUID = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

test.describe("liveblocks auth endpoint", () => {
  test("refuses an unauthenticated request", async ({ request }) => {
    const response = await request.post("/api/liveblocks-auth", {
      data: { room: `board:${VALID_UUID}` },
    });
    expect(response.status()).toBe(401);
  });

  test("refuses an unauthenticated request for a malformed room", async ({ request }) => {
    const response = await request.post("/api/liveblocks-auth", {
      data: { room: "not-a-room" },
    });
    // 401 before 403: identity is established before the room is even parsed.
    expect(response.status()).toBe(401);
  });

  test("never returns a token to an anonymous caller", async ({ request }) => {
    const response = await request.post("/api/liveblocks-auth", {
      data: { room: `board:${VALID_UUID}` },
    });
    const body = await response.text();

    // A Liveblocks access token is a JWT; nothing resembling one may appear.
    expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
    expect(body.toLowerCase()).not.toContain("token");
  });

  test("is never marked publicly cacheable", async ({ request }) => {
    // The success response carries a Liveblocks room access token, and the
    // failure responses are authorization-dependent. Setting no Cache-Control
    // at all lets the platform default apply — on Vercel that is
    // "public, max-age=0, must-revalidate", which marks a bearer-token
    // response public. Only visible against a real deployment.
    const response = await request.post("/api/liveblocks-auth", {
      data: { room: `board:${VALID_UUID}` },
    });
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl).not.toMatch(/(^|,)\s*public/);
    expect(cacheControl).toMatch(/no-store/);
  });

  test("rejects a GET — the endpoint is POST-only", async ({ request }) => {
    const response = await request.get("/api/liveblocks-auth");
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});

/**
 * NOT COVERED — needs a linked Supabase project and a Liveblocks project:
 *   - an editor receiving "*:write" and a viewer receiving "*:read"
 *   - a non-member receiving 403
 *   - an archived board downgrading an editor to read-only
 *   - two browser contexts seeing each other's cursors and edits
 *
 * The permission decision itself is exercised without a network in
 * tests/integration/rls.test.ts (board_access_role / can_edit_board) and the
 * room-name trust boundary in tests/unit/liveblocks-rooms.test.ts.
 */
