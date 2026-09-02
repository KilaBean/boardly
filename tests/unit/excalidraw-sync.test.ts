import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  ELEMENTS_MAP,
  LOCAL_ORIGIN,
  readAllElements,
  readRemoteElements,
  seedDocFromElements,
  shouldReplace,
  writeElementsToDoc,
  type SyncElement,
} from "@/features/boards/canvas/excalidraw-sync";

/**
 * Collaboration correctness, against two real Y.Docs.
 *
 * This is the layer where a mistake corrupts other people's work rather than
 * merely breaking a screen, so it is tested with actual documents and actual
 * update exchange rather than mocks — the interesting failures (echoing your
 * own edits back, two clients disagreeing about who won) only appear once real
 * transaction origins and real events are involved.
 */

type Element = SyncElement & { text?: string };

function element(id: string, version: number, extra: Partial<Element> = {}): Element {
  return { id, version, versionNonce: 1, ...extra };
}

/** Two docs wired together, the way two browsers would be. */
function connectedDocs() {
  const a = new Y.Doc();
  const b = new Y.Doc();

  a.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(b, update, "sync");
  });
  b.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(a, update, "sync");
  });

  return {
    a,
    b,
    mapA: a.getMap<Element>(ELEMENTS_MAP),
    mapB: b.getMap<Element>(ELEMENTS_MAP),
  };
}

describe("shouldReplace", () => {
  it("accepts anything when nothing is stored", () => {
    expect(shouldReplace(undefined, element("a", 1))).toBe(true);
  });

  it("accepts a newer version", () => {
    expect(shouldReplace(element("a", 1), element("a", 2))).toBe(true);
  });

  it("rejects an older version", () => {
    // The case that matters: a slow client re-sending stale state must not
    // roll everyone else back.
    expect(shouldReplace(element("a", 5), element("a", 4))).toBe(false);
  });

  it("rejects the same version unchanged", () => {
    expect(shouldReplace(element("a", 3), element("a", 3))).toBe(false);
  });

  it("breaks an equal-version tie the same way on every client", () => {
    const mine = element("a", 3, { versionNonce: 10 });
    const theirs = element("a", 3, { versionNonce: 4 });

    // Lower nonce wins, whichever side is asking — that consistency is the
    // whole point, otherwise two clients each keep their own and never agree.
    expect(shouldReplace(mine, theirs)).toBe(true);
    expect(shouldReplace(theirs, mine)).toBe(false);
  });
});

describe("writeElementsToDoc", () => {
  it("writes elements the room has not seen", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Element>(ELEMENTS_MAP);

    expect(writeElementsToDoc(doc, map, [element("a", 1), element("b", 1)])).toBe(2);
    expect(map.size).toBe(2);
  });

  it("writes nothing when the scene is unchanged", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Element>(ELEMENTS_MAP);
    const scene = [element("a", 1), element("b", 1)];

    writeElementsToDoc(doc, map, scene);

    // Excalidraw hands over the whole scene on every pointer move; re-sending
    // it all would flood the room.
    expect(writeElementsToDoc(doc, map, scene)).toBe(0);
  });

  it("writes only what actually changed", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Element>(ELEMENTS_MAP);
    writeElementsToDoc(doc, map, [element("a", 1), element("b", 1)]);

    expect(writeElementsToDoc(doc, map, [element("a", 1), element("b", 2)])).toBe(1);
    expect(map.get("b")?.version).toBe(2);
  });

  it("marks its transaction as local", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Element>(ELEMENTS_MAP);

    let origin: unknown = null;
    doc.on("afterTransaction", (transaction: Y.Transaction) => {
      origin = transaction.origin;
    });

    writeElementsToDoc(doc, map, [element("a", 1)]);
    expect(origin).toBe(LOCAL_ORIGIN);
  });
});

describe("readRemoteElements", () => {
  it("ignores our own writes", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Element>(ELEMENTS_MAP);

    const seen: Element[][] = [];
    map.observe((event, transaction) => {
      seen.push(readRemoteElements(event, transaction, map));
    });

    writeElementsToDoc(doc, map, [element("a", 1)]);

    // Without this the edit comes straight back, is re-applied, produces
    // another change, and loops forever.
    expect(seen).toEqual([[]]);
  });

  it("reports a collaborator's edit", () => {
    const { a, mapA, mapB } = connectedDocs();

    const seen: Element[][] = [];
    mapB.observe((event, transaction) => {
      seen.push(readRemoteElements(event, transaction, mapB));
    });

    writeElementsToDoc(a, mapA, [element("a", 1, { text: "hello" })]);

    expect(seen.flat()).toHaveLength(1);
    expect(seen.flat()[0]).toMatchObject({ id: "a", text: "hello" });
  });

  it("reports a deletion as an ordinary update", () => {
    const { a, mapA, mapB } = connectedDocs();
    writeElementsToDoc(a, mapA, [element("a", 1)]);

    const seen: Element[][] = [];
    mapB.observe((event, transaction) => {
      seen.push(readRemoteElements(event, transaction, mapB));
    });

    // Excalidraw soft-deletes: the element stays and its version moves on.
    writeElementsToDoc(a, mapA, [{ ...element("a", 2), text: "gone" }]);

    expect(seen.flat()[0]).toMatchObject({ id: "a", version: 2 });
    expect(mapB.has("a")).toBe(true);
  });
});

describe("seedDocFromElements", () => {
  it("seeds an empty room from the saved snapshot", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Element>(ELEMENTS_MAP);

    expect(seedDocFromElements(doc, map, [element("a", 1)])).toBe(true);
    expect(readAllElements(map)).toHaveLength(1);
  });

  it("refuses to overwrite a room that already has content", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<Element>(ELEMENTS_MAP);
    writeElementsToDoc(doc, map, [element("live", 7)]);

    // The room is the live document. Seeding over it would discard whatever
    // collaborators did while this client was away.
    expect(seedDocFromElements(doc, map, [element("stale", 1)])).toBe(false);
    expect(readAllElements(map)).toHaveLength(1);
    expect(map.has("live")).toBe(true);
  });
});

describe("two clients converge", () => {
  it("agrees on the same scene after concurrent edits", () => {
    const { a, b, mapA, mapB } = connectedDocs();

    writeElementsToDoc(a, mapA, [element("shared", 1)]);
    writeElementsToDoc(a, mapA, [element("from-a", 1)]);
    writeElementsToDoc(b, mapB, [element("from-b", 1)]);
    writeElementsToDoc(b, mapB, [element("shared", 2, { text: "b wins" })]);

    const fromA = Object.fromEntries(readAllElements(mapA).map((e) => [e.id, e.version]));
    const fromB = Object.fromEntries(readAllElements(mapB).map((e) => [e.id, e.version]));

    expect(fromA).toEqual(fromB);
    expect(mapA.get("shared")?.text).toBe("b wins");
  });
});
