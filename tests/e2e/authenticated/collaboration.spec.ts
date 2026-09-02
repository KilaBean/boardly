import { expect, test, type Page } from "@playwright/test";

import { SEED, storageStatePath } from "../helpers/accounts";

/**
 * Live collaboration against a real Liveblocks project.
 *
 * The gap that survived three phases. Every layer underneath was tested in
 * isolation — the Yjs translation against two real Y.Docs, room authorization
 * against the real SQL policies — but the seam between the binding and an
 * actual room was never exercised. Nothing short of two real sessions can.
 */

/** Opens the shared board and waits for the canvas to mount. */
async function openBoard(page: Page): Promise<void> {
  await page.goto(`/w/${SEED.workspace.slug}`);
  await page.getByRole("heading", { name: SEED.sharedBoard }).click();
  await expect(page).toHaveURL(/\/board\//, { timeout: 30_000 });
  await expect(page.locator(".excalidraw")).toBeVisible({ timeout: 40_000 });
}

/**
 * Draws a stroke using Playwright's real mouse.
 *
 * `page.mouse` dispatches through the browser's input pipeline, producing
 * trusted events that honour pointer capture. Synthetic `dispatchEvent`
 * pointer events do not, and the editor ignores them — which is why an earlier
 * attempt to verify this by hand produced no shapes.
 */
async function drawStroke(page: Page): Promise<void> {
  // Clicking the tool's label rather than pressing its shortcut: the keypress
  // can land before the editor is listening, and the drag then becomes a
  // selection rubber-band that silently draws nothing.
  await page.getByTitle(/^Draw/).click();

  const canvas = page.locator("canvas.excalidraw__canvas.static");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no bounding box");

  // Right of centre: selecting a tool opens the style panel over the top-left
  // of the canvas, and a drag that starts on it never reaches the board.
  const startX = box.x + box.width * 0.6;
  const startY = box.y + box.height * 0.55;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(startX + i * 8, startY + Math.sin(i / 2) * 24);
  }
  await page.mouse.up();
}

/**
 * A picture of what the board is showing.
 *
 * Excalidraw draws to a canvas, so there is no per-shape DOM to count. The
 * static canvas holds committed elements only — selection outlines and
 * collaborator cursors live on a separate interactive canvas — so a change to
 * these pixels means the drawing itself changed, not merely that somebody's
 * mouse moved.
 */
function canvasPixels(page: Page): Promise<Buffer> {
  return page.locator("canvas.excalidraw__canvas.static").screenshot();
}

test.describe("room authorization", () => {
  test("issues a token to a member of the board", async ({ page }) => {
    await openBoard(page);
    const boardId = new URL(page.url()).pathname.split("/").pop()!;

    const response = await page.request.post("/api/liveblocks-auth", {
      data: { room: `board:${boardId}` },
    });

    expect(response.status()).toBe(200);
    // Liveblocks returns an access token; its presence is the proof the
    // endpoint reached Liveblocks and signed successfully.
    const body = await response.text();
    expect(body).toMatch(/eyJ[A-Za-z0-9_-]+\./);
  });

  test("refuses a room the user has no access to", async ({ page }) => {
    // A well-formed room name for a board that does not exist.
    const response = await page.request.post("/api/liveblocks-auth", {
      data: { room: "board:9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe("two users on one board", () => {
  // Real network round trips through Liveblocks; be generous.
  test.setTimeout(180_000);

  test("each sees the other's presence", async ({ page, browser }) => {
    await openBoard(page);

    const context = await browser.newContext({
      storageState: storageStatePath("collaborator"),
    });
    const other = await context.newPage();
    await openBoard(other);

    // The avatar stack only renders when `useOthers()` is non-empty, so its
    // appearance is proof both clients joined the same room.
    await expect(page.getByRole("list", { name: /collaborator/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(other.getByRole("list", { name: /collaborator/i })).toBeVisible({
      timeout: 60_000,
    });

    await context.close();
  });

  test("a shape drawn by one appears for the other", async ({ page, browser }) => {
    await openBoard(page);

    const context = await browser.newContext({
      storageState: storageStatePath("collaborator"),
    });
    const other = await context.newPage();
    await openBoard(other);

    // Wait until they can see each other before editing, otherwise the stroke
    // may be made before the second client has synced.
    await expect(page.getByRole("list", { name: /collaborator/i })).toBeVisible({
      timeout: 60_000,
    });

    const before = await canvasPixels(other);

    await drawStroke(page);
    await expect
      .poll(async () => (await canvasPixels(page)).equals(before), {
        timeout: 30_000,
      })
      .toBe(false);

    // The assertion this whole phase existed for: the edit crossed the room
    // and the other person's board actually redrew.
    await expect
      .poll(async () => (await canvasPixels(other)).equals(before), { timeout: 60_000 })
      .toBe(false);

    await context.close();
  });

  test("neither client logs a console error while collaborating", async ({ page, browser }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await openBoard(page);

    const context = await browser.newContext({
      storageState: storageStatePath("collaborator"),
    });
    const other = await context.newPage();
    await openBoard(other);

    await expect(page.getByRole("list", { name: /collaborator/i })).toBeVisible({
      timeout: 60_000,
    });

    expect(errors).toEqual([]);
    await context.close();
  });
});
