/**
 * Debounced autosave with a maximum wait.
 *
 * A plain debounce is wrong for a canvas: someone drawing continuously never
 * pauses long enough to trigger a save, so their work stays unsaved for as
 * long as they keep working. A plain interval is also wrong — it writes even
 * when nothing changed.
 *
 * So this fires on either condition:
 *   - `quietMs` has passed since the last change (the common case), or
 *   - `maxWaitMs` has passed since the FIRST unsaved change (the safety net).
 *
 * Extracted from the canvas so the timing rules can be tested with fake timers
 * instead of by drawing on a whiteboard and waiting.
 */

export type SaveScheduler = {
  /** Note that something changed; schedules a save. */
  schedule: () => void;
  /** Save immediately if there are pending changes (e.g. on unmount). */
  flush: () => void;
  /** Discard pending timers without saving. */
  cancel: () => void;
  /** Whether a save is currently pending. */
  isPending: () => boolean;
};

export type SaveSchedulerOptions = {
  /** Idle period after the last change before saving. */
  quietMs: number;
  /** Hard ceiling from the first unsaved change. Must be >= quietMs. */
  maxWaitMs: number;
  onSave: () => void;
};

export function createSaveScheduler({
  quietMs,
  maxWaitMs,
  onSave,
}: SaveSchedulerOptions): SaveScheduler {
  if (maxWaitMs < quietMs) {
    throw new Error("maxWaitMs must be greater than or equal to quietMs");
  }

  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (quietTimer !== null) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
    if (maxTimer !== null) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  }

  function fire() {
    clearTimers();
    onSave();
  }

  return {
    schedule() {
      // Restart the quiet timer on every change.
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(fire, quietMs);

      // Start the ceiling only once, on the first change of a burst, so a
      // continuous stream of edits still saves every maxWaitMs.
      if (maxTimer === null) {
        maxTimer = setTimeout(fire, maxWaitMs);
      }
    },

    flush() {
      if (quietTimer === null && maxTimer === null) return;
      fire();
    },

    cancel() {
      clearTimers();
    },

    isPending() {
      return quietTimer !== null || maxTimer !== null;
    },
  };
}
