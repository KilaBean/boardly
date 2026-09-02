"use client";

import { getSceneVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { saveBoardSnapshotAction } from "@/features/boards/snapshots/actions";
import { createSaveScheduler } from "@/lib/scheduling/save-scheduler";

import type { BoardScene } from "./scene";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Save after 2s of stillness, but never let changes sit longer than 15s. */
const QUIET_MS = 2_000;
const MAX_WAIT_MS = 15_000;

/**
 * Autosaves the canvas to Postgres.
 *
 * Deleted elements are kept in the snapshot on purpose. Excalidraw does not
 * remove an element when you delete it — it sets `isDeleted` and bumps the
 * version — and those tombstones are what stop a deletion from being undone by
 * a collaborator whose copy still has the original.
 *
 * Per-viewer state is not saved: scroll position, zoom, selection and the
 * active tool belong to the person looking at the board, and restoring them
 * would mean one collaborator's viewport yanking everybody else's.
 *
 * ## Listening and writing are separate concerns
 *
 * Writes wait for the room to sync, because a snapshot taken before the room
 * has been received could be missing a collaborator's newer work. *Listening*
 * must not wait, and originally did: the hook was mounted only once Liveblocks
 * had synced — several seconds against a hosted room — so everything drawn in
 * the meantime scheduled no save at all. If the person then stopped drawing,
 * the board was never written to Postgres, existed only in the room, and
 * reopening it rendered an empty canvas.
 *
 * So the listener attaches on mount and records that there is something to
 * save; `synced` gates only the write, and the moment it flips the outstanding
 * changes are flushed.
 *
 * ## Why remote changes are saved too
 *
 * Excalidraw's `onChange` does not say who caused a change, so a collaborator's
 * edit schedules a save here just as a local one does. That is deliberate
 * rather than merely convenient: it means the durable snapshot can never fall
 * behind the room, which is the failure that made boards come back blank. It
 * does not loop — a write to Postgres is not broadcast to anyone — and the
 * scene-version check below throws away the redundant saves that several
 * clients would otherwise make of identical content.
 */
export function useBoardPersistence({
  api,
  boardId,
  enabled,
  synced,
}: {
  api: ExcalidrawImperativeAPI | null;
  boardId: string;
  /** False for viewers and archived boards — they must never write. */
  enabled: boolean;
  /** The room has finished syncing, so a snapshot is safe to take. */
  synced: boolean;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  // Kept in refs so the change listener never needs to be torn down and
  // rebuilt when a save completes or the room finishes syncing.
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  /** Changes have happened that no save has covered yet. */
  const pendingRef = useRef(false);
  const syncedRef = useRef(synced);
  /**
   * Scene version already in Postgres, so an unchanged board writes nothing.
   *
   * Excalidraw's scene version is the sum of every element's version counter,
   * which moves on any edit and is far cheaper to compare than the document.
   * Seeded from whatever was loaded at mount: opening a board is not a change,
   * and without this every visit would append a redundant snapshot.
   */
  const savedVersionRef = useRef<number | null>(null);

  const save = useCallback(async () => {
    if (!api || !enabled) return;

    // Coalesce concurrent requests: a save already in flight picks up the
    // newer changes on its next loop iteration rather than queuing a second
    // request.
    if (savingRef.current) {
      dirtyRef.current = true;
      return;
    }

    savingRef.current = true;
    try {
      do {
        dirtyRef.current = false;

        const elements = api.getSceneElementsIncludingDeleted();
        const version = getSceneVersion(elements);
        if (version === savedVersionRef.current) break;

        setStatus("saving");

        const scene: BoardScene = {
          elements: [...elements],
          appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
          files: api.getFiles(),
        };

        const result = await saveBoardSnapshotAction(boardId, scene);
        if (result.ok) savedVersionRef.current = version;
        setStatus(result.ok ? "saved" : "error");
      } while (dirtyRef.current);
    } catch {
      // Network failure. The next change reschedules a save, so this recovers
      // without any retry logic of its own.
      setStatus("error");
    } finally {
      savingRef.current = false;
    }
  }, [api, boardId, enabled]);

  useEffect(() => {
    if (!api || !enabled) return;

    // The scene as it arrived is by definition already saved.
    if (savedVersionRef.current === null) {
      savedVersionRef.current = getSceneVersion(api.getSceneElementsIncludingDeleted());
    }

    /** Write only if there is something to write and it is safe to do so. */
    const saveIfPending = () => {
      if (!pendingRef.current || !syncedRef.current) return;
      pendingRef.current = false;
      void save();
    };

    const scheduler = createSaveScheduler({
      quietMs: QUIET_MS,
      maxWaitMs: MAX_WAIT_MS,
      // Before the room has synced this is a no-op that deliberately leaves
      // `pendingRef` set: the sync effect below picks the work up instead.
      onSave: saveIfPending,
    });

    const unsubscribe = api.onChange(() => {
      pendingRef.current = true;
      scheduler.schedule();
    });

    // A tab being hidden is the last reliable moment to persist on mobile,
    // where the tab may be discarded without ever firing unload.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") scheduler.flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Flush rather than cancel: unmount usually means navigating away, and
      // discarding the last few seconds of work would be indefensible.
      scheduler.flush();
    };
  }, [api, enabled, save]);

  // Sync landing is itself a checkpoint: anything drawn while waiting for the
  // room, and anything the room itself brought in, is written now rather than
  // waiting for an edit that may never come.
  useEffect(() => {
    syncedRef.current = synced;
    if (!synced || !api || !enabled || !pendingRef.current) return;

    pendingRef.current = false;
    void save();
  }, [synced, api, enabled, save]);

  return { status };
}
