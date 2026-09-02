import type * as Y from "yjs";

/**
 * Translation layer between an Excalidraw scene and a Yjs document.
 *
 * Deliberately free of Excalidraw and Liveblocks imports: these functions move
 * plain elements in and out of a `Y.Map`. That keeps the genuinely error-prone
 * part of collaboration — what to write, what to skip, and how to avoid
 * echoing your own changes back — testable against two real Y.Docs in Node,
 * with no browser, no editor and no network.
 *
 * The hook in `use-yjs-binding.ts` supplies the Excalidraw side.
 *
 * ## Why there is no delete path
 *
 * Excalidraw never removes an element: deleting sets `isDeleted: true` and
 * bumps `version`, so a deletion is an ordinary update. The map therefore only
 * ever grows, and the "a stale local copy resurrects a deleted element"
 * problem does not exist here — the tombstone is itself an element, and the
 * higher version wins like any other edit.
 */

/** Name of the shared map holding scene elements. */
export const ELEMENTS_MAP = "elements";

/**
 * Transaction origin marking a change as locally produced.
 *
 * Yjs echoes every transaction to observers, including our own. Without an
 * origin to compare against, applying a local edit would come straight back as
 * a "remote" change, be re-applied to the scene, produce another local change,
 * and loop forever.
 */
export const LOCAL_ORIGIN = "boardly-local";

/**
 * The subset of an Excalidraw element this layer needs to know about.
 *
 * `version` increments on every mutation and `versionNonce` is a random
 * tie-break, which is exactly the ordering Excalidraw's own reconciler uses.
 */
export type SyncElement = {
  id: string;
  version: number;
  versionNonce?: number;
};

/**
 * True when `next` should replace `current` in the shared map.
 *
 * Higher version wins. On an equal version — two clients editing from the same
 * base — the lower `versionNonce` wins, which is arbitrary but *consistent*:
 * every client picks the same one, so they converge instead of ping-ponging.
 */
export function shouldReplace<E extends SyncElement>(current: E | undefined, next: E): boolean {
  if (!current) return true;
  if (next.version !== current.version) return next.version > current.version;
  if (next.versionNonce === undefined || current.versionNonce === undefined) return false;
  return next.versionNonce < current.versionNonce;
}

/**
 * Writes locally-changed elements into the shared map.
 *
 * Excalidraw's `onChange` fires on every pointer move during a drag and always
 * hands over the whole scene, so writing all of it every time would flood the
 * room. Only elements the map does not already hold at that version are
 * written, which also breaks the echo: an element we just applied *from* the
 * map is skipped rather than sent straight back.
 *
 * Wrapped in a single `transact` so collaborators receive one update rather
 * than one per element.
 *
 * @returns how many elements were written, for tests and diagnostics.
 */
export function writeElementsToDoc<E extends SyncElement>(
  doc: Y.Doc,
  elements: Y.Map<E>,
  scene: readonly E[],
): number {
  const changed = scene.filter((element) => shouldReplace(elements.get(element.id), element));
  if (changed.length === 0) return 0;

  doc.transact(() => {
    for (const element of changed) {
      elements.set(element.id, element);
    }
  }, LOCAL_ORIGIN);

  return changed.length;
}

/**
 * Reads a Yjs map event into the elements the scene should apply.
 *
 * Returns nothing for a locally-originated transaction — that check is the
 * loop breaker described on `LOCAL_ORIGIN`.
 */
export function readRemoteElements<E extends SyncElement>(
  event: Y.YMapEvent<E>,
  transaction: Y.Transaction,
  elements: Y.Map<E>,
): E[] {
  if (transaction.origin === LOCAL_ORIGIN) return [];

  const incoming: E[] = [];
  event.changes.keys.forEach((_change, id) => {
    const element = elements.get(id);
    // A key is never deleted (see the note at the top), so a missing value
    // means a malformed update rather than a removal.
    if (element) incoming.push(element);
  });

  return incoming;
}

/**
 * Populates an empty shared document from the local scene.
 *
 * Called only when the room's document is empty — the first client to open a
 * board seeds it from the last saved snapshot. If the room already has
 * elements, the room wins: it is the live state, and overwriting it with a
 * stale snapshot would silently discard other people's work.
 */
export function seedDocFromElements<E extends SyncElement>(
  doc: Y.Doc,
  elements: Y.Map<E>,
  scene: readonly E[],
): boolean {
  if (elements.size > 0) return false;

  doc.transact(() => {
    for (const element of scene) {
      elements.set(element.id, element);
    }
  }, LOCAL_ORIGIN);

  return true;
}

/** Every element currently in the shared document. */
export function readAllElements<E extends SyncElement>(elements: Y.Map<E>): E[] {
  return [...elements.values()];
}
