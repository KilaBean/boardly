"use client";

import { CaptureUpdateAction, reconcileElements } from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useRoom } from "@liveblocks/react";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import { useEffect, useState } from "react";
import type * as Y from "yjs";

import {
  ELEMENTS_MAP,
  readAllElements,
  readRemoteElements,
  seedDocFromElements,
  writeElementsToDoc,
} from "./excalidraw-sync";

/** `reconcileElements` brands its remote input; the brand carries no runtime data. */
type RemoteElements = Parameters<typeof reconcileElements>[1];

/**
 * Binds an Excalidraw scene to a Liveblocks-backed Yjs document.
 *
 * The translation itself lives in `excalidraw-sync.ts` and is unit tested
 * against two real Y.Docs. This hook is the wiring: subscribe, unsubscribe,
 * and decide who wins on first connection.
 *
 * Merging is Excalidraw's own `reconcileElements` rather than anything of
 * ours. It knows the rules that keep a scene coherent — element ordering,
 * fractional indices, which local edits must survive a remote update — and
 * getting those subtly wrong produces corruption that only shows up under real
 * concurrent editing.
 *
 * Remote updates are applied with `CaptureUpdateAction.NEVER` so a
 * collaborator's edit never lands in *our* undo stack: pressing ctrl-Z must
 * undo your own last action, not somebody else's.
 */
export function useYjsBinding({
  api,
  enabled,
}: {
  api: ExcalidrawImperativeAPI | null;
  enabled: boolean;
}) {
  const room = useRoom();
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!api || !enabled) return;

    const provider = getYjsProviderForRoom(room);
    const doc = provider.getYDoc();
    const yElements = doc.getMap<OrderedExcalidrawElement>(ELEMENTS_MAP);

    const applyToScene = (incoming: OrderedExcalidrawElement[]) => {
      if (incoming.length === 0) return;

      const reconciled = reconcileElements(
        api.getSceneElementsIncludingDeleted(),
        incoming as unknown as RemoteElements,
        api.getAppState(),
      );

      api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
    };

    /**
     * First connection decides the source of truth.
     *
     * An empty room means we are the first client in, so the room is seeded
     * from the last saved snapshot already loaded into the scene. A non-empty
     * room is the live document and always wins — overwriting it with our
     * snapshot would silently discard whatever collaborators have done since.
     */
    const onSynced = () => {
      const local = api.getSceneElementsIncludingDeleted();
      const seeded = seedDocFromElements(doc, yElements, local);

      if (!seeded) {
        // Applying these counts as a change, so persistence will write them —
        // that is how a board that exists only in the room gets a snapshot.
        applyToScene(readAllElements(yElements));
      }
      setSynced(true);
    };

    if (provider.synced) {
      onSynced();
    } else {
      provider.on("synced", onSynced);
    }

    // The scene is read back from the API rather than taken from the callback
    // argument, so that deleted elements are definitely included: Excalidraw
    // deletes by setting `isDeleted`, and a list that quietly omitted those
    // would mean deletions never reaching collaborators at all.
    //
    // That scene is the whole document on every change, including what we just
    // applied from the room. `writeElementsToDoc` filters by version, which is
    // what stops it from echoing back out.
    const unsubscribe = api.onChange(() => {
      writeElementsToDoc(doc, yElements, api.getSceneElementsIncludingDeleted());
    });

    const observer = (event: Y.YMapEvent<OrderedExcalidrawElement>, transaction: Y.Transaction) => {
      applyToScene(readRemoteElements(event, transaction, yElements));
    };
    yElements.observe(observer);

    return () => {
      unsubscribe();
      yElements.unobserve(observer);
      provider.off("synced", onSynced);
      // The provider is cached per room by Liveblocks and may be shared, so it
      // is deliberately not destroyed here — only our subscriptions are.
    };
  }, [api, enabled, room]);

  return { synced };
}
