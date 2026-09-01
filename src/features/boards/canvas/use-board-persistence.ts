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
 */
export function useBoardPersistence({
  editor,
  boardId,
  enabled,
}: {
  editor: Editor | null;
  boardId: string;
  /** False for viewers and archived boards — they must never write. */
  enabled: boolean;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  // Kept in a ref so the store listener never needs to be torn down and
  // rebuilt when a save completes.
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);

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

    const scheduler = createSaveScheduler({
      quietMs: QUIET_MS,
      maxWaitMs: MAX_WAIT_MS,
      onSave: () => void save(),
    });

    const unlisten = editor.store.listen(() => scheduler.schedule(), {
      source: "user",
      scope: "document",
    });

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

  return { status };
}
