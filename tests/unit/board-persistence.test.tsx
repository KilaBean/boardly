import { act, renderHook } from "@testing-library/react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
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

/**
 * Excalidraw's entrypoint pulls in the whole editor — fonts, canvas, a JSON
 * import Node will not load without an import attribute — none of which this
 * hook needs. Only `getSceneVersion` is used, and only as a change detector:
 * the sum of element versions moves whenever anything is edited.
 */
vi.mock("@excalidraw/excalidraw", () => ({
  getSceneVersion: (elements: readonly { version: number }[]) =>
    elements.reduce((total, element) => total + element.version, 0),
}));

const BOARD_ID = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const QUIET_MS = 2_000;

type ChangeListener = () => void;

let nextVersion = 1;

/**
 * The narrow slice of `ExcalidrawImperativeAPI` this hook touches: a change
 * subscription and a readable scene. A real editor needs a DOM, a canvas and
 * a font loader, none of which say anything about when we save.
 *
 * Elements carry a `version` because the hook skips saving a scene whose
 * version it has already written — so a fake that never changes version would
 * make every save look like a no-op.
 */
function createFakeApi() {
  const listeners = new Set<ChangeListener>();
  let elements = [{ id: "a", version: nextVersion++ }];

  const api = {
    onChange(callback: ChangeListener) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => ({ viewBackgroundColor: "#ffffff" }),
    getFiles: () => ({}),
  };

  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    /** Simulate an edit: the scene version moves, then subscribers are told. */
    change() {
      elements = [{ id: "a", version: nextVersion++ }];
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

type Props = { synced: boolean; enabled: boolean };

function renderPersistence(api: ExcalidrawImperativeAPI, { synced = false, enabled = true } = {}) {
  return renderHook((props: Props) => useBoardPersistence({ api, boardId: BOARD_ID, ...props }), {
    initialProps: { synced, enabled },
  });
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
    const fake = createFakeApi();
    renderPersistence(fake.api, { synced: false });

    // The regression in one assertion: the listener must exist before sync.
    expect(fake.listenerCount()).toBe(1);
  });

  it("does not write a snapshot yet", () => {
    const fake = createFakeApi();
    renderPersistence(fake.api, { synced: false });

    act(() => {
      fake.change();
      vi.advanceTimersByTime(QUIET_MS);
    });

    // A snapshot taken now could be missing a collaborator's newer work.
    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });

  it("saves the changes made while waiting, the moment sync lands", () => {
    const fake = createFakeApi();
    const { rerender } = renderPersistence(fake.api, { synced: false });

    act(() => {
      fake.change();
      vi.advanceTimersByTime(QUIET_MS);
    });
    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();

    // No further edit — this is the case that lost data. Someone draws, the
    // room is still connecting, and they stop. Sync alone has to trigger it.
    act(() => {
      rerender({ synced: true, enabled: true });
    });

    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
    expect(saveBoardSnapshotAction).toHaveBeenCalledWith(
      BOARD_ID,
      expect.objectContaining({ elements: expect.any(Array) }),
    );
  });

  it("saves pre-sync changes even when the quiet period never elapsed", () => {
    const fake = createFakeApi();
    const { rerender } = renderPersistence(fake.api, { synced: false });

    act(() => {
      fake.change();
      // Sync arrives while the debounce is still running.
      vi.advanceTimersByTime(QUIET_MS / 2);
      rerender({ synced: true, enabled: true });
    });

    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
  });

  it("does not write when nothing was drawn before sync", () => {
    const fake = createFakeApi();
    const { rerender } = renderPersistence(fake.api, { synced: false });

    act(() => {
      rerender({ synced: true, enabled: true });
      vi.advanceTimersByTime(QUIET_MS);
    });

    // Opening a board is not a change. Saving here would append a redundant
    // snapshot version on every visit.
    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });
});

describe("a board that was only ever in the room", () => {
  it("writes a snapshot for content the room brought in, not just local edits", () => {
    const fake = createFakeApi();
    const { rerender } = renderPersistence(fake.api, { synced: false });

    // Restoring a board out of the Liveblocks room reaches this hook as an
    // ordinary change, because Excalidraw's onChange does not say who caused
    // it. That is what lets a board that exists only in the room finally get
    // a durable snapshot, instead of waiting for an edit that may never come.
    act(() => {
      fake.change();
      rerender({ synced: true, enabled: true });
    });

    expect(saveBoardSnapshotAction).toHaveBeenCalledTimes(1);
  });

  it("skips the write when the room held exactly what was already saved", () => {
    const fake = createFakeApi();
    const { rerender } = renderPersistence(fake.api, { synced: false });

    // Sync applied nothing new, so the scene version still matches what is in
    // Postgres. Saving anyway would append a snapshot on every single visit.
    act(() => {
      rerender({ synced: true, enabled: true });
      vi.advanceTimersByTime(QUIET_MS);
    });

    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });

  it("still refuses to write for a viewer", () => {
    const fake = createFakeApi();
    const { rerender } = renderPersistence(fake.api, { synced: false, enabled: false });

    act(() => {
      fake.change();
      rerender({ synced: true, enabled: false });
      vi.advanceTimersByTime(QUIET_MS);
    });

    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });
});

describe("once synced", () => {
  it("saves after the quiet period", () => {
    const fake = createFakeApi();
    renderPersistence(fake.api, { synced: true });

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
    const fake = createFakeApi();
    renderPersistence(fake.api, { synced: true });

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

    const fake = createFakeApi();
    const { result } = renderPersistence(fake.api, { synced: true });

    await act(async () => {
      fake.change();
      vi.advanceTimersByTime(QUIET_MS);
    });

    expect(result.current.status).toBe("error");
  });
});

describe("viewers and archived boards", () => {
  it("never listens, so no viewer can write a snapshot", () => {
    const fake = createFakeApi();
    renderPersistence(fake.api, { synced: true, enabled: false });

    expect(fake.listenerCount()).toBe(0);
  });

  it("stays silent even once the room syncs", () => {
    const fake = createFakeApi();
    const { rerender } = renderPersistence(fake.api, { synced: false, enabled: false });

    act(() => {
      fake.change();
      rerender({ synced: true, enabled: false });
      vi.advanceTimersByTime(QUIET_MS);
    });

    expect(saveBoardSnapshotAction).not.toHaveBeenCalled();
  });
});

describe("leaving the board", () => {
  it("flushes pending changes on unmount rather than dropping them", () => {
    const fake = createFakeApi();
    const { unmount } = renderPersistence(fake.api, { synced: true });

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
    const fake = createFakeApi();
    renderPersistence(fake.api, { synced: true });

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
