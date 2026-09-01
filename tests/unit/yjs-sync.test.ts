import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  applyStoreChangesToDoc,
  LOCAL_ORIGIN,
  readAllRecords,
  readRemoteChanges,
  RECORDS_MAP,
  seedDocFromRecords,
  type StoreChanges,
  type SyncRecord,
} from "@/features/boards/canvas/yjs-sync";

/**
 * The collaboration translation layer, tested against two real Yjs documents
 * wired directly to each other. No network, no Liveblocks, no browser — but
 * genuine CRDT behaviour, which is what actually decides whether two people
 * drawing at once end up with the same board.
 */

type Rec = SyncRecord & { x?: number };

/** Two peers that exchange updates directly, as a real connection would. */
function connectedPeers() {
  const a = new Y.Doc();
  const b = new Y.Doc();

  a.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "from-peer") return;
    Y.applyUpdate(b, update, "from-peer");
  });
  b.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "from-peer") return;
    Y.applyUpdate(a, update, "from-peer");
  });

  return {
    a,
    b,
    aRecords: a.getMap<Rec>(RECORDS_MAP),
    bRecords: b.getMap<Rec>(RECORDS_MAP),
  };
}

function changes(partial: Partial<StoreChanges<Rec>>): StoreChanges<Rec> {
  return { added: {}, updated: {}, removed: {}, ...partial };
}

describe("applyStoreChangesToDoc", () => {
  it("propagates an added record to the other peer", () => {
    const { a, aRecords, bRecords } = connectedPeers();
    const shape: Rec = { id: "shape:1", typeName: "shape", x: 10 };

    applyStoreChangesToDoc(a, aRecords, changes({ added: { "shape:1": shape } }));

    expect(bRecords.get("shape:1")).toEqual(shape);
  });

  it("propagates an update", () => {
    const { a, aRecords, bRecords } = connectedPeers();
    const before: Rec = { id: "shape:1", typeName: "shape", x: 10 };
    const after: Rec = { id: "shape:1", typeName: "shape", x: 99 };

    applyStoreChangesToDoc(a, aRecords, changes({ added: { "shape:1": before } }));
    applyStoreChangesToDoc(a, aRecords, changes({ updated: { "shape:1": [before, after] } }));

    expect(bRecords.get("shape:1")?.x).toBe(99);
  });

  it("propagates a deletion", () => {
    const { a, aRecords, bRecords } = connectedPeers();
    const shape: Rec = { id: "shape:1", typeName: "shape" };

    applyStoreChangesToDoc(a, aRecords, changes({ added: { "shape:1": shape } }));
    applyStoreChangesToDoc(a, aRecords, changes({ removed: { "shape:1": shape } }));

    expect(bRecords.has("shape:1")).toBe(false);
  });

  it("sends one update for a batch, not one per record", () => {
    // Dragging thirty shapes must not produce thirty messages.
    const { a, aRecords } = connectedPeers();
    let updates = 0;
    a.on("update", () => {
      updates += 1;
    });

    applyStoreChangesToDoc(
      a,
      aRecords,
      changes({
        added: Object.fromEntries(
          Array.from({ length: 30 }, (_, i) => [
            `shape:${i}`,
            { id: `shape:${i}`, typeName: "shape" },
          ]),
        ),
      }),
    );

    expect(updates).toBe(1);
  });
});

describe("readRemoteChanges — the echo-loop guard", () => {
  it("ignores our own transaction", () => {
    // Without this, applying a local edit would come back as "remote", be
    // re-applied, emit another local change, and loop forever.
    const doc = new Y.Doc();
    const records = doc.getMap<Rec>(RECORDS_MAP);

    const seen: { put: Rec[]; remove: string[] }[] = [];
    records.observe((event, transaction) => {
      seen.push(readRemoteChanges(event, transaction, records));
    });

    applyStoreChangesToDoc(
      doc,
      records,
      changes({ added: { "shape:1": { id: "shape:1", typeName: "shape" } } }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ put: [], remove: [] });
  });

  it("reports a genuinely remote addition", () => {
    const { a, b, aRecords, bRecords } = connectedPeers();

    const seen: { put: Rec[]; remove: string[] }[] = [];
    bRecords.observe((event, transaction) => {
      seen.push(readRemoteChanges(event, transaction, bRecords));
    });

    applyStoreChangesToDoc(
      a,
      aRecords,
      changes({ added: { "shape:1": { id: "shape:1", typeName: "shape", x: 5 } } }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.put).toEqual([{ id: "shape:1", typeName: "shape", x: 5 }]);
    expect(seen[0]!.remove).toEqual([]);
    expect(b.getMap(RECORDS_MAP).size).toBe(1);
  });

  it("reports a remote deletion as an id to remove", () => {
    const { a, aRecords, bRecords } = connectedPeers();
    const shape: Rec = { id: "shape:1", typeName: "shape" };
    applyStoreChangesToDoc(a, aRecords, changes({ added: { "shape:1": shape } }));

    const seen: { put: Rec[]; remove: string[] }[] = [];
    bRecords.observe((event, transaction) => {
      seen.push(readRemoteChanges(event, transaction, bRecords));
    });

    applyStoreChangesToDoc(a, aRecords, changes({ removed: { "shape:1": shape } }));

    expect(seen[0]!.remove).toEqual(["shape:1"]);
    expect(seen[0]!.put).toEqual([]);
  });

  it("treats a non-local origin as remote", () => {
    const doc = new Y.Doc();
    const records = doc.getMap<Rec>(RECORDS_MAP);

    const seen: { put: Rec[]; remove: string[] }[] = [];
    records.observe((event, transaction) => {
      seen.push(readRemoteChanges(event, transaction, records));
    });

    doc.transact(() => {
      records.set("shape:1", { id: "shape:1", typeName: "shape" });
    }, "some-other-origin");

    expect(seen[0]!.put).toHaveLength(1);
  });
});

describe("seedDocFromRecords", () => {
  it("seeds an empty document", () => {
    const doc = new Y.Doc();
    const records = doc.getMap<Rec>(RECORDS_MAP);

    const seeded = seedDocFromRecords(doc, records, [
      { id: "shape:1", typeName: "shape" },
      { id: "shape:2", typeName: "shape" },
    ]);

    expect(seeded).toBe(true);
    expect(records.size).toBe(2);
  });

  it("refuses to overwrite a document that already has content", () => {
    // The live room always wins. Seeding over it would discard whatever
    // collaborators did since our snapshot was taken.
    const doc = new Y.Doc();
    const records = doc.getMap<Rec>(RECORDS_MAP);
    records.set("shape:live", { id: "shape:live", typeName: "shape" });

    const seeded = seedDocFromRecords(doc, records, [{ id: "shape:stale", typeName: "shape" }]);

    expect(seeded).toBe(false);
    expect(records.size).toBe(1);
    expect(records.has("shape:live")).toBe(true);
    expect(records.has("shape:stale")).toBe(false);
  });

  it("marks the seed as local so it is not echoed back into the store", () => {
    const doc = new Y.Doc();
    const records = doc.getMap<Rec>(RECORDS_MAP);

    let origin: unknown;
    doc.on("afterTransaction", (transaction: Y.Transaction) => {
      origin = transaction.origin;
    });

    seedDocFromRecords(doc, records, [{ id: "shape:1", typeName: "shape" }]);
    expect(origin).toBe(LOCAL_ORIGIN);
  });
});

describe("convergence", () => {
  it("reaches the same state when both peers edit at once", () => {
    // The property that matters: concurrent edits must not diverge.
    const { a, b, aRecords, bRecords } = connectedPeers();

    applyStoreChangesToDoc(
      a,
      aRecords,
      changes({ added: { "shape:a": { id: "shape:a", typeName: "shape", x: 1 } } }),
    );
    applyStoreChangesToDoc(
      b,
      bRecords,
      changes({ added: { "shape:b": { id: "shape:b", typeName: "shape", x: 2 } } }),
    );

    const fromA = readAllRecords(aRecords).sort((x, y) => x.id.localeCompare(y.id));
    const fromB = readAllRecords(bRecords).sort((x, y) => x.id.localeCompare(y.id));

    expect(fromA).toEqual(fromB);
    expect(fromA).toHaveLength(2);
  });

  it("converges when both peers write the same record", () => {
    const { aRecords, bRecords, a, b } = connectedPeers();

    applyStoreChangesToDoc(
      a,
      aRecords,
      changes({ added: { "shape:1": { id: "shape:1", typeName: "shape", x: 1 } } }),
    );
    applyStoreChangesToDoc(
      b,
      bRecords,
      changes({ added: { "shape:1": { id: "shape:1", typeName: "shape", x: 2 } } }),
    );

    // Last-writer-wins per key, but crucially both peers agree on the winner.
    expect(aRecords.get("shape:1")).toEqual(bRecords.get("shape:1"));
  });
});
