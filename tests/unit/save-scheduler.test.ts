import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSaveScheduler } from "@/lib/scheduling/save-scheduler";

/**
 * Autosave timing decides whether someone loses work. Testing it with fake
 * timers is the only way to assert the rules without drawing on a canvas and
 * waiting fifteen seconds.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const OPTIONS = { quietMs: 2_000, maxWaitMs: 15_000 };

describe("quiet period", () => {
  it("saves once the changes stop", () => {
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    scheduler.schedule();
    vi.advanceTimersByTime(1_999);
    expect(onSave).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("restarts the quiet period on every change", () => {
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    scheduler.schedule();
    vi.advanceTimersByTime(1_500);
    scheduler.schedule();
    vi.advanceTimersByTime(1_500);

    // 3s elapsed, but never 2s of stillness.
    expect(onSave).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not fire again without new changes", () => {
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    scheduler.schedule();
    vi.advanceTimersByTime(2_000);
    expect(onSave).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("maximum wait", () => {
  it("saves during continuous activity that never goes quiet", () => {
    // The failure a plain debounce has: someone drawing without pause would
    // otherwise never trigger a save.
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    for (let elapsed = 0; elapsed < 15_000; elapsed += 1_000) {
      scheduler.schedule();
      vi.advanceTimersByTime(1_000);
    }

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh ceiling for the next burst", () => {
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    for (let elapsed = 0; elapsed < 15_000; elapsed += 1_000) {
      scheduler.schedule();
      vi.advanceTimersByTime(1_000);
    }
    expect(onSave).toHaveBeenCalledTimes(1);

    for (let elapsed = 0; elapsed < 15_000; elapsed += 1_000) {
      scheduler.schedule();
      vi.advanceTimersByTime(1_000);
    }
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});

describe("flush", () => {
  it("saves immediately when a change is pending", () => {
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    scheduler.schedule();
    scheduler.flush();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does nothing when nothing is pending", () => {
    // Unmounting a board nobody edited must not write a snapshot.
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    scheduler.flush();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears pending timers so no second save follows", () => {
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    scheduler.schedule();
    scheduler.flush();
    vi.advanceTimersByTime(60_000);

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("cancel", () => {
  it("discards pending saves", () => {
    const onSave = vi.fn();
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave });

    scheduler.schedule();
    scheduler.cancel();
    vi.advanceTimersByTime(60_000);

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("isPending", () => {
  it("tracks whether a save is outstanding", () => {
    const scheduler = createSaveScheduler({ ...OPTIONS, onSave: () => {} });

    expect(scheduler.isPending()).toBe(false);
    scheduler.schedule();
    expect(scheduler.isPending()).toBe(true);

    vi.advanceTimersByTime(2_000);
    expect(scheduler.isPending()).toBe(false);
  });
});

describe("configuration", () => {
  it("rejects a ceiling shorter than the quiet period", () => {
    // Would make maxWait fire first every time, silently turning the quiet
    // period into dead configuration.
    expect(() =>
      createSaveScheduler({ quietMs: 5_000, maxWaitMs: 1_000, onSave: () => {} }),
    ).toThrow(/maxWaitMs/);
  });

  it("allows equal values", () => {
    expect(() =>
      createSaveScheduler({ quietMs: 1_000, maxWaitMs: 1_000, onSave: () => {} }),
    ).not.toThrow();
  });
});
