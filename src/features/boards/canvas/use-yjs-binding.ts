"use client";

import { useRoom } from "@liveblocks/react";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import { useEffect, useState } from "react";
import type { Editor, TLRecord } from "tldraw";
import type * as Y from "yjs";

import {
  applyStoreChangesToDoc,
  readAllRecords,
  readRemoteChanges,
  RECORDS_MAP,
  seedDocFromRecords,
  type StoreChanges,
} from "./yjs-sync";

/**
 * Binds a tldraw store to a Liveblocks-backed Yjs document.
 *
 * The translation itself lives in `yjs-sync.ts` and is unit tested against two
 * real Y.Docs. This hook is the wiring: subscribe, unsubscribe, and decide who
 * wins on first connection.
 *
 * Every write back into the store goes through `store.mergeRemoteChanges`,
 * which marks the change with source `"remote"`. Our own store listener
 * filters to source `"user"`, so applying a collaborator's edit cannot be
 * mistaken for a local one and bounced straight back to them.
 */
export function useYjsBinding({ editor, enabled }: { editor: Editor | null; enabled: boolean }) {
  const room = useRoom();
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!editor || !enabled) return;

    const provider = getYjsProviderForRoom(room);
    const doc = provider.getYDoc();
    const yRecords = doc.getMap<TLRecord>(RECORDS_MAP);

    const applyToStore = (put: TLRecord[], remove: string[]) => {
      if (put.length === 0 && remove.length === 0) return;
      editor.store.mergeRemoteChanges(() => {
        if (remove.length > 0) {
          editor.store.remove(remove as TLRecord["id"][]);
        }
        if (put.length > 0) {
          editor.store.put(put);
        }
      });
    };

    /**
     * First connection decides the source of truth.
     *
     * An empty room means we are the first client in, so the room is seeded
     * from the last saved snapshot already loaded into the store. A non-empty
     * room is the live document and always wins — overwriting it with our
     * snapshot would silently discard whatever collaborators have done since.
     */
    const onSynced = () => {
      // `serialize()` defaults to document scope, excluding per-user session
      // records like camera and selection, which must never be shared.
      const localRecords = Object.values(editor.store.serialize()) as TLRecord[];
      const seeded = seedDocFromRecords(doc, yRecords, localRecords);

      if (!seeded) {
        applyToStore(readAllRecords(yRecords), []);
      }
      setSynced(true);
    };

    if (provider.synced) {
      onSynced();
    } else {
      provider.on("synced", onSynced);
    }

    const unlisten = editor.store.listen(
      ({ changes }) => {
        applyStoreChangesToDoc(doc, yRecords, changes as unknown as StoreChanges<TLRecord>);
      },
      { source: "user", scope: "document" },
    );

    const observer = (event: Y.YMapEvent<TLRecord>, transaction: Y.Transaction) => {
      const { put, remove } = readRemoteChanges(event, transaction, yRecords);
      applyToStore(put, remove);
    };
    yRecords.observe(observer);

    return () => {
      unlisten();
      yRecords.unobserve(observer);
      provider.off("synced", onSynced);
      // The provider is cached per room by Liveblocks and may be shared, so it
      // is deliberately not destroyed here — only our subscriptions are.
    };
  }, [editor, enabled, room]);

  return { synced };
}
