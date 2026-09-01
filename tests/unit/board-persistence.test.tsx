import { act, renderHook } from "@testing-library/react";
import type { Editor } from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBoardPersistence } from "@/features/boards/canvas/use-board-persistence";

/**
 * Autosave, at the seam the scheduler tests could not reach.
 *
 * `save-scheduler.test.ts` proves the timing rules in isolation. What it cannot
 * prove is that the canvas is *wired* to them, and that is exactly where this
 * broke in production: the hook used to be mounted only once the Liveblocks
 * room had synced, so the store listener missed every change made in the
 * seconds before that. A board drawn on and then left alone was never written
 * to Postgres at all — it survived only as long as the room did, and reopening
 * it showed an empty canvas.
 *
 * The rule these tests pin down: listening starts immediately, writing waits
 * for `synced`, and nothing in between is lost.
 */

const saveBoardSnapshotAction = vi.hoisted(() => vi.fn());

vi.mock("@/features/boards/snapshots/actions", () => ({ saveBoardSnapshotAction }));

const BOARD_ID = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const QUIET_MS = 2_000;

type StoreListener = () => void;

/**
 * The narrow slice of `Editor` this hook touches: a store you can listen to
 * and a snapshot you can read. Everything else on a real editor needs a DOM,
 * a canvas and a schema, none of which say anything about when we save.
 */
function createFakeEditor() {
  const listeners = new Set<StoreListener>();

  const editor = {
    store: {
      listen(callback: StoreListener) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
    getSnapshot: () => ({ document: { store: {}, schema: {} }, session: {} }),
  };

  return {
    editor: editor as unknown as Editor,
    /** Simulate a user edit reaching the store. */
    change() {
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

type Props = { synced: boolean; enabled: boolean; backfill: boolean };

function renderPersistence(
  editor: Editor,
  { synced = false, enabled = true, backfill = false } = {},
) {
  return renderHook(
    (props: Props) => useBoardPersistence({ editor, boardId: BOARD_ID, ...props }),
    { initialProps: { synced, enabled, backfill } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  saveBoardSnapshotAction.mockResolvedValue({ ok: true, data: { version: 1 } });
});

afterEach(() => {
  vi.useRealTimers();
  saveBoardSnapshotAction.mockReset();
});

describe("before the room has synced", () => {
  it("listens to the store immediately", () => {
    const fake = createFakeEditor();
    renderPersistence(fake.editor, { synced: false });

    // The regression in one assertion: the listener must exist before sync.
    expect(fake.listenerCount()).toBe(1);
  });

  it("does not write a snapshot yet", () => {
    const fake = createFakeEditor();
    renderPersistence(fake.editor, { synced: false });

    act(() => {
      fake.change();
      vi.advanceTimersByTime(QUIET_MS);
    });

    // A snapshot taken now could be missing a collaborator's newer work.
    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });

  it("saves the changes made while waiting, the moment sync lands", () => {
    const fake = createFakeEditor();
    const { rerender } = renderPersistence(fake.editor, { synced: false });

    act(() => {
      fake.change();
      vi.advanceTimersByTime(QUIET_MS);
    });
    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();

    // No further edit — this is the case that lost data. Someone draws, the
    // room is still connecting, and they stop. Sync alone has to trigger it.
    act(() => {
      rerender({ synced: true, enabled: true, backfill: false });
    });

    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
    expect(saveBoardSnapshotAction).toHaveBeenCalledWith(BOARD_ID, { store: {}, schema: {} });
  });

  it("saves pre-sync changes even when the quiet period never elapsed", () => {
    const fake = createFakeEditor();
    const { rerender } = renderPersistence(fake.editor, { synced: false });

    act(() => {
      fake.change();
      // Sync arrives while the debounce is still running.
      vi.advanceTimersByTime(QUIET_MS / 2);
      rerender({ synced: true, enabled: true, backfill: false });
    });

    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
  });

  it("does not write when nothing was drawn before sync", () => {
    const fake = createFakeEditor();
    const { rerender } = renderPersistence(fake.editor, { synced: false });

    act(() => {
      rerender({ synced: true, enabled: true, backfill: false });
      vi.advanceTimersByTime(QUIET_MS);
    });

    // Opening a board is not a change. Saving here would append a redundant
    // snapshot version on every visit.
    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });
});

describe("a board that was only ever in the room", () => {
  it("writes a snapshot on sync even though this client changed nothing", () => {
    const fake = createFakeEditor();
    const { rerender } = renderPersistence(fake.editor, { synced: false });

    // Restoring from the room is a "remote" change, so it never reaches the
    // autosave listener. Without the backfill the board stays unbacked.
    act(() => {
      rerender({ synced: true, enabled: true, backfill: true });
    });

    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
  });

  it("still refuses to write for a viewer", () => {
    const fake = createFakeEditor();
    const { rerender } = renderPersistence(fake.editor, { synced: false, enabled: false });

    act(() => {
      rerender({ synced: true, enabled: false, backfill: true });
    });

    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });
});

describe("once synced", () => {
  it("saves after the quiet period", () => {
    const fake = createFakeEditor();
    renderPersistence(fake.editor, { synced: true });

    act(() => {
      fake.change();
      vi.advanceTimersByTime(QUIET_MS - 1);
    });
    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
  });

  it("does not save again when nothing further changed", () => {
    const fake = createFakeEditor();
    renderPersistence(fake.editor, { synced: true });

    act(() => {
      fake.change();
      vi.advanceTimersByTime(QUIET_MS);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
  });

  it("reports the failure rather than pretending the board is safe", async () => {
    saveBoardSnapshotAction.mockResolvedValue({ ok: false, error: "nope" });

    const fake = createFakeEditor();
    const { result } = renderPersistence(fake.editor, { synced: true });

    await act(async () => {
      fake.change();
      vi.advanceTimersByTime(QUIET_MS);
    });

    expect(result.current.status).toBe("error");
  });
});

describe("viewers and archived boards", () => {
  it("never listens, so no viewer can write a snapshot", () => {
    const fake = createFakeEditor();
    renderPersistence(fake.editor, { synced: true, enabled: false });

    expect(fake.listenerCount()).toBe(0);
  });

  it("stays silent even once the room syncs", () => {
    const fake = createFakeEditor();
    const { rerender } = renderPersistence(fake.editor, { synced: false, enabled: false });

    act(() => {
      fake.change();
      rerender({ synced: true, enabled: false, backfill: false });
      vi.advanceTimersByTime(QUIET_MS);
    });

    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });
});

describe("leaving the board", () => {
  it("flushes pending changes on unmount rather than dropping them", () => {
    const fake = createFakeEditor();
    const { unmount } = renderPersistence(fake.editor, { synced: true });

    act(() => {
      fake.change();
      // Well inside the quiet period: navigating away must not discard this.
      vi.advanceTimersByTime(100);
    });
    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });
    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
  });

  it("flushes when the tab is hidden", () => {
    const fake = createFakeEditor();
    renderPersistence(fake.editor, { synced: true });

    act(() => {
      fake.change();
      vi.advanceTimersByTime(100);
    });

    act(() => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
  });
});
