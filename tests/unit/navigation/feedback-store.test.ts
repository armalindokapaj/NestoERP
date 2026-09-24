import { describe, expect, it } from "vitest";

import { createFeedbackStore, SLOW_AFTER_MS, trackedDestination } from "@/lib/navigation/feedback-store";

/**
 * Navigation feedback's state (NAV-01 NAV-01..NAV-03): which clicks begin a
 * pending navigation, and that only the current ticket may end one.
 */

const here = { origin: "https://app.nesto.test", pathname: "/finance", search: "?status=open" };

function manualTimers() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle: unknown) => {
      const index = timers.indexOf(handle as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers.filter((entry) => entry.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    },
  };
}

describe("which navigations are tracked (NAV-02, N03-N05)", () => {
  it("tracks another path, and a different query on the same path", () => {
    expect(trackedDestination("/finance/invoices", here)).toBe("/finance/invoices");
    expect(trackedDestination("?status=paid", here)).toBe("/finance?status=paid");
    expect(trackedDestination("https://app.nesto.test/tasks?x=1#top", here)).toBe("/tasks?x=1");
  });

  it("does not track the page already shown, a hash on it, or another origin", () => {
    expect(trackedDestination("/finance?status=open", here)).toBeNull();
    expect(trackedDestination("#totals", here)).toBeNull();
    expect(trackedDestination("/finance?status=open#totals", here)).toBeNull();
    expect(trackedDestination("https://example.com/finance", here)).toBeNull();
    expect(trackedDestination("//example.com/x", here)).toBeNull();
  });
});

describe("ticket ownership (NAV-03, N06)", () => {
  it("lets only the current ticket settle: A's late callback cannot clear B", () => {
    const store = createFeedbackStore(manualTimers());
    const a = store.begin("/a", "sidebar");
    const b = store.begin("/b", "sidebar");
    store.settle(a);
    expect(store.getSnapshot().ticket?.id).toBe(b.id);
    expect(store.isPendingTo("/b")).toBe(true);
    expect(store.isPendingTo("/a")).toBe(false);
    store.settle(b);
    expect(store.getSnapshot().ticket).toBeNull();
  });

  it("clears on any commit, a redirect's included", () => {
    const store = createFeedbackStore(manualTimers());
    store.begin("/projects/p1", "record");
    store.committed();
    expect(store.getSnapshot().ticket).toBeNull();
  });

  it("says the wait is long after 10 s, and only for the ticket still pending", () => {
    const timers = manualTimers();
    const store = createFeedbackStore(timers);
    store.begin("/a", "tab");
    timers.advance(SLOW_AFTER_MS - 1);
    expect(store.getSnapshot().slow).toBe(false);
    const b = store.begin("/b", "tab");
    timers.advance(SLOW_AFTER_MS - 1);
    expect(store.getSnapshot().slow).toBe(false);
    timers.advance(1);
    expect(store.getSnapshot()).toMatchObject({ slow: true, ticket: { id: b.id } });
    store.committed();
    expect(store.getSnapshot()).toEqual({ ticket: null, slow: false });
  });

  it("notifies subscribers on each change", () => {
    const store = createFeedbackStore(manualTimers());
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.begin("/a", "record");
    store.reset();
    unsubscribe();
    store.begin("/b", "record");
    expect(calls).toBe(2);
  });
});

describe("workspace changes (NAV-03, QC-11)", () => {
  it("end a pending navigation that did not switch the workspace", () => {
    const store = createFeedbackStore(manualTimers());
    store.begin("/tasks", "sidebar");
    store.workspaceChanged();
    expect(store.getSnapshot().ticket).toBeNull();
  });

  it("let the navigation that switched it continue, once", () => {
    const store = createFeedbackStore(manualTimers());
    const own = store.begin("/tasks/new", "quick-create", { ownsWorkspaceSwitch: true });
    store.workspaceChanged();
    expect(store.getSnapshot().ticket?.id).toBe(own.id);
    store.workspaceChanged();
    expect(store.getSnapshot().ticket).toBeNull();
  });
});
