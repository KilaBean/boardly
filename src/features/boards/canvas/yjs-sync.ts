import type * as Y from "yjs";

/**
 * Translation layer between a tldraw store and a Yjs document.
 *
 * These functions are deliberately free of tldraw and Liveblocks imports: they
 * move plain records in and out of a `Y.Map`. That keeps the genuinely
 * error-prone part of collaboration — what to write, what to skip, and how to
 * avoid echoing your own changes back — testable against two real Y.Docs in
 * Node, with no browser, no editor and no network.
 *
 * The hook in `use-yjs-binding.ts` supplies the tldraw side.
 */

/** Name of the shared map holding document records. */
export const RECORDS_MAP = "records";

/**
 * Transaction origin marking a change as locally produced.
 *
 * Yjs echoes every transaction to observers, including our own. Without an
 * origin to compare against, applying a local edit would come straight back as
 * a "remote" change, be re-applied to the store, produce another local change,
 * and loop forever.
 */
export const LOCAL_ORIGIN = "boardly-local";

/** The subset of a tldraw record this layer needs to know about. */
export type SyncRecord = { id: string; typeName: string };

/** Shape of tldraw's `RecordsDiff`, narrowed to what we consume. */
export type StoreChanges<R extends SyncRecord = SyncRecord> = {
  added: Record<string, R>;
  updated: Record<string, [from: R, to: R]>;
  removed: Record<string, R>;
};

/**
 * Writes a batch of local store changes into the shared map.
 *
 * Wrapped in a single `transact` so collaborators receive one update rather
 * than one per shape — dragging a selection of thirty shapes should not
 * produce thirty messages.
 */
export function applyStoreChangesToDoc<R extends SyncRecord>(
  doc: Y.Doc,
  records: Y.Map<R>,
  changes: StoreChanges<R>,
): void {
  doc.transact(() => {
    for (const record of Object.values(changes.added)) {
      records.set(record.id, record);
    }
    for (const [, next] of Object.values(changes.updated)) {
      records.set(next.id, next);
    }
    for (const record of Object.values(changes.removed)) {
      records.delete(record.id);
    }
  }, LOCAL_ORIGIN);
}

/** Records to add/update and ids to delete, derived from a remote event. */
export type RemoteChanges<R extends SyncRecord = SyncRecord> = {
  put: R[];
  remove: string[];
};

/**
 * Reads a Yjs map event into the changes a tldraw store should apply.
 *
 * Returns empty arrays for a locally-originated transaction — that check is
 * the loop breaker described on `LOCAL_ORIGIN`.
 */
export function readRemoteChanges<R extends SyncRecord>(
  event: Y.YMapEvent<R>,
  transaction: Y.Transaction,
  records: Y.Map<R>,
): RemoteChanges<R> {
  if (transaction.origin === LOCAL_ORIGIN) {
    return { put: [], remove: [] };
  }

  const put: R[] = [];
  const remove: string[] = [];

  event.changes.keys.forEach((change, id) => {
    if (change.action === "delete") {
      remove.push(id);
      return;
    }
    // "add" and "update" both mean: take the current value.
    const record = records.get(id);
    if (record) put.push(record);
  });

  return { put, remove };
}

/**
 * Populates an empty shared document from local records.
 *
 * Called only when the room's document is empty — the first client to open a
 * board seeds it from the last saved snapshot. If the room already has
 * records, the room wins: it is the live state, and overwriting it with a
 * stale snapshot would silently discard other people's work.
 */
export function seedDocFromRecords<R extends SyncRecord>(
  doc: Y.Doc,
  records: Y.Map<R>,
  localRecords: readonly R[],
): boolean {
  if (records.size > 0) return false;

  doc.transact(() => {
    for (const record of localRecords) {
      records.set(record.id, record);
    }
  }, LOCAL_ORIGIN);

  return true;
}

/** Every record currently in the shared document. */
export function readAllRecords<R extends SyncRecord>(records: Y.Map<R>): R[] {
  return [...records.values()];
}
