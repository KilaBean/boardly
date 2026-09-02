import { describe, expect, it } from "vitest";

import { isLegacyTldrawSnapshot, parseScene } from "@/features/boards/canvas/scene";

/**
 * Reading a snapshot back.
 *
 * Snapshots are opaque `jsonb`: Postgres does not know or check the canvas
 * format, so this function is the only thing standing between a malformed row
 * and a board page that throws. Every unreadable shape must come back as null
 * — an empty board — rather than as an exception.
 */

const element = { id: "el-1", type: "rectangle", version: 3 };

describe("parseScene", () => {
  it("reads a scene written by the canvas", () => {
    const scene = parseScene({ elements: [element] });
    expect(scene?.elements).toHaveLength(1);
  });

  it("keeps the board's background colour", () => {
    // Board-level appearance is shared; scroll and zoom are not, and must not
    // come back from someone else's session.
    const scene = parseScene({
      elements: [],
      appState: { viewBackgroundColor: "#fff8e7", scrollX: 900, zoom: { value: 4 } },
    });

    expect(scene?.appState).toEqual({ viewBackgroundColor: "#fff8e7" });
  });

  it("keeps image files so a reloaded board is not full of broken images", () => {
    const files = { "file-1": { id: "file-1", dataURL: "data:image/png;base64,AA" } };
    expect(parseScene({ elements: [], files })?.files).toEqual(files);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "elements"],
    ["an array", [element]],
    ["an object with no elements", { appState: {} }],
    ["elements that are not an array", { elements: { "0": element } }],
  ])("returns null for %s", (_label, value) => {
    expect(parseScene(value)).toBeNull();
  });

  it("drops entries that are not elements rather than failing outright", () => {
    // One bad row should cost the shapes it damaged, not the whole board.
    const scene = parseScene({ elements: [element, null, 42, { type: "rectangle" }] });
    expect(scene?.elements).toHaveLength(1);
  });

  it("refuses a snapshot from the previous canvas library", () => {
    // tldraw stored `{ store, schema }`. There is no shared document model, so
    // this cannot be migrated — it has to read as unreadable rather than
    // silently render blank and get overwritten.
    expect(parseScene({ store: {}, schema: { schemaVersion: 2 } })).toBeNull();
  });
});

describe("isLegacyTldrawSnapshot", () => {
  it("recognises a tldraw snapshot", () => {
    expect(isLegacyTldrawSnapshot({ store: {}, schema: {} })).toBe(true);
  });

  it("does not mistake an Excalidraw scene for one", () => {
    expect(isLegacyTldrawSnapshot({ elements: [element] })).toBe(false);
  });

  it.each([null, undefined, "store", 7])("handles %s", (value) => {
    expect(isLegacyTldrawSnapshot(value)).toBe(false);
  });
});
