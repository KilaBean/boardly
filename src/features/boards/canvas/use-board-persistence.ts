"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";

import { saveBoardSnapshotAction } from "@/features/boards/snapshots/actions";
import { createSaveScheduler } from "@/lib/scheduling/save-scheduler";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Save after 2s of stillness, but never let changes sit longer than 15s. */
const QUIET_MS = 2_000;
const MAX_WAIT_MS = 15_000;

/**
 * Autosaves the canvas document to Postgres.
 *
 * Only `document` is persisted, never `session`: session state is the camera
 * position, selection and UI flags, which are per-user. Saving it would mean
 * one collaborator's scroll position yanking everyone else's viewport the next
 * time the board loads.
 *
 * Listening is filtered to `{ source: "user", scope: "document" }`. Without
 * the source filter, applying a remote or restored change would itself
 * schedule a save, and two clients would ping-pong writes forever.
 *
 * ## Listening and writing are separate concerns
 *
 * Writes wait for the room to sync, because a snapshot taken before the room
 * has been received could be missing a collaborator's newer work. *Listening*
 * must not wait, and originally did: the hook was mounted with
 * `enabled: canEdit && synced`, so the store listener was only attached once
 * Liveblocks finished syncing — several seconds in against a hosted room.
 * Everything drawn in the meantime produced no scheduled save, and if the
 * person then stopped drawing there was nothing left to trigger one. The board
 * was never written to Postgres at all; it existed only in the Liveblocks room,
 * so reopening it rendered an empty canvas until the room replayed (and stayed
 * empty for good once the room was gone).
 *
 * So the listener attaches on mount and records that there is something to
 * save; `synced` gates only the write itself, and the moment it flips the
 * outstanding changes are flushed.
 */
export function useBoardPersistence({
  editor,
  boardId,
  enabled,
  synced,
  backfill = false,
}: {
  editor: Editor | null;
  boardId: string;
  /** False for viewers and archived boards — they must never write. */
  enabled: boolean;
  /** The room has finished syncing, so a snapshot is safe to take. */
  synced: boolean;
  /**
   * The canvas was restored from the room and Postgres has no snapshot of it —
   * so save once on sync even though this client changed nothing.
   *
   * Left by the bug above: boards drawn before it was fixed exist only in their
   * Liveblocks room, and room content arrives as a "remote" change, which
   * autosave ignores by design. Without this they would stay unbacked until
   * somebody happened to edit them, and vanish for good if the room went away.
   */
  backfill?: boolean;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  // Kept in refs so the store listener never needs to be torn down and rebuilt
  // when a save completes or the room finishes syncing.
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  /** Changes have happened that no save has covered yet. */
  const pendingRef = useRef(false);
  const syncedRef = useRef(synced);

  const save = useCallback(async () => {
    if (!editor || !enabled) return;

    // Coalesce concurrent requests: a save already in flight picks up the
    // newer changes on its next loop iteration rather than queuing a second
    // request. Written as a loop rather than a recursive call so React
    // Compiler can still memoize this callback.
    if (savingRef.current) {
      dirtyRef.current = true;
      return;
    }

    savingRef.current = true;
    try {
      do {
        dirtyRef.current = false;
        setStatus("saving");

        const { document } = editor.getSnapshot();
        const result = await saveBoardSnapshotAction(boardId, document);
        setStatus(result.ok ? "saved" : "error");
      } while (dirtyRef.current);
    } catch {
      // Network failure. The next change reschedules a save, so this recovers
      // without any retry logic of its own.
      setStatus("error");
    } finally {
      savingRef.current = false;
    }
  }, [editor, boardId, enabled]);

  useEffect(() => {
    if (!editor || !enabled) return;

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

    const unlisten = editor.store.listen(
      () => {
        pendingRef.current = true;
        scheduler.schedule();
      },
      { source: "user", scope: "document" },
    );

    // A tab being hidden is the last reliable moment to persist on mobile,
    // where the tab may be discarded without ever firing unload.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") scheduler.flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      unlisten();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Flush rather than cancel: unmount usually means navigating away, and
      // discarding the last few seconds of work would be indefensible.
      scheduler.flush();
    };
  }, [editor, enabled, save]);

  // Sync landing is itself a checkpoint: anything drawn while waiting for the
  // room is written now rather than waiting for the next stroke that may never
  // come.
  useEffect(() => {
    syncedRef.current = synced;
    if (!synced || !editor || !enabled) return;
    if (!pendingRef.current && !backfill) return;

    pendingRef.current = false;
    void save();
  }, [synced, editor, enabled, backfill, save]);

  return { status };
}
