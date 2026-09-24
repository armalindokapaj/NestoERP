import { describe, expect, it } from "vitest";

import {
  createActivityController,
  type ActivityEnvironment,
  type ActivityTransport,
  type ReadResult,
} from "@/lib/activity/activity-controller";
import type { ActivityCounts, ActivityPage, ActivityType } from "@/lib/modules/activity/activity-center.service";

/** A clock whose timers run only when the test advances it. */
function fakeEnvironment() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const state = { visible: true, online: true };
  const env: ActivityEnvironment = {
    now: () => now,
    setTimeout: (callback, ms) => {
      id += 1;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
    visible: () => state.visible,
    online: () => state.online,
    jitter: () => 0,
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (let guard = 0; ; guard += 1) {
      if (guard > 10_000) throw new Error("runaway timers");
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
      await flush();
    }
    now = end;
    await flush();
  }
  return { env, state, advance };
}

const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

const counts = (total: number, extra: Partial<ActivityCounts> = {}): ActivityCounts => ({ total, notifications: total, announcements: 0, critical: 0, attention: 0, ...extra });
const page = (label: string, rows = 1): ActivityPage => ({ items: Array.from({ length: rows }, (_, index) => ({ key: `${label}-${index}` })), nextCursor: null }) as unknown as ActivityPage;

/** A transport that answers at once, or holds answers until the test releases them. */
function fakeTransport({ hold = false } = {}) {
  const calls: Array<{ kind: "count" | "list"; type?: ActivityType; release: (result: ReadResult<unknown>) => void; signal: AbortSignal }> = [];
  let countAnswer: ReadResult<ActivityCounts> = { ok: true, data: counts(1) };
  const transport: ActivityTransport = {
    count: (signal) =>
      new Promise((resolve) => {
        calls.push({ kind: "count", release: resolve as (result: ReadResult<unknown>) => void, signal });
        if (!hold) resolve(countAnswer);
      }),
    list: (type, signal) =>
      new Promise((resolve) => {
        calls.push({ kind: "list", type, release: resolve as (result: ReadResult<unknown>) => void, signal });
        if (!hold) resolve({ ok: true, data: page(type) });
      }),
  };
  return {
    transport,
    calls,
    counted: () => calls.filter((call) => call.kind === "count").length,
    listed: () => calls.filter((call) => call.kind === "list").length,
    answerCountWith: (result: ReadResult<ActivityCounts>) => (countAnswer = result),
  };
}

function setup({ hold = false } = {}) {
  const clock = fakeEnvironment();
  const fake = fakeTransport({ hold });
  const events = { unauthenticated: 0, mismatch: 0 };
  const controller = createActivityController({
    contextKey: "ctx-a",
    transport: fake.transport,
    environment: clock.env,
    onUnauthenticated: () => (events.unauthenticated += 1),
    onContextMismatch: () => (events.mismatch += 1),
  });
  return { ...clock, ...fake, controller, events };
}

describe("the Activity controller (NAV-03 §9)", () => {
  it("a closed, healthy bell reads the count at most six times in ten visible minutes, and no list (A01)", async () => {
    const { controller, advance, counted, listed } = setup();
    controller.start();
    await advance(10 * 60_000);
    expect(counted()).toBeLessThanOrEqual(6);
    expect(counted()).toBeGreaterThanOrEqual(5);
    expect(listed()).toBe(0);
  });

  it("starts after the core is ready, or two seconds at most", async () => {
    const { controller, advance, counted } = setup();
    controller.start();
    await advance(1_999);
    expect(counted()).toBe(0);
    await advance(1);
    expect(counted()).toBe(1);
  });

  it("starts nothing while hidden, and reads once on return (A02)", async () => {
    const { controller, advance, counted, state } = setup();
    controller.start({ coreReady: true });
    await advance(0);
    expect(counted()).toBe(1);
    state.visible = false;
    controller.changed(); // another tab changed something
    await advance(5 * 60_000);
    expect(counted()).toBe(1);
    state.visible = true;
    controller.resume();
    controller.resume();
    await advance(300);
    expect(counted()).toBe(2);
  });

  it("coalesces focus, visibility and online into one read, only when stale (A03)", async () => {
    const { controller, advance, counted } = setup();
    controller.start({ coreReady: true });
    await advance(0);
    controller.resume();
    controller.resume();
    controller.resume();
    await advance(300);
    expect(counted()).toBe(1); // fresh: nothing to do
    await advance(40_000);
    controller.resume();
    controller.resume();
    await advance(300);
    expect(counted()).toBe(2);
  });

  it("opening overtakes the initial delay, and the delay then issues nothing (A04)", async () => {
    const { controller, advance, counted, listed } = setup();
    controller.start();
    controller.setOpen(true);
    await advance(0);
    expect(counted()).toBe(1);
    expect(listed()).toBe(1);
    controller.setOpen(false);
    controller.setOpen(true); // within 30 s: the cached page and a fresh count serve
    await advance(2_500);
    expect(counted()).toBe(1);
    expect(listed()).toBe(1);
  });

  it("only the selected tab's answer publishes, and changing tabs reads no count (A05)", async () => {
    const { controller, advance, calls, counted } = setup({ hold: true });
    controller.start({ coreReady: true });
    controller.setOpen(true);
    calls.find((call) => call.kind === "count")!.release({ ok: true, data: counts(2) });
    await advance(0);
    controller.selectTab("NOTIFICATION");
    controller.selectTab("ANNOUNCEMENT");
    const lists = calls.filter((call) => call.kind === "list");
    expect(lists.map((call) => call.type)).toEqual(["ALL", "NOTIFICATION", "ANNOUNCEMENT"]);
    expect(lists[0].signal.aborted && lists[1].signal.aborted).toBe(true);
    lists[0].release({ ok: true, data: page("ALL") });
    lists[2].release({ ok: true, data: page("ANNOUNCEMENT") });
    lists[1].release({ ok: true, data: page("NOTIFICATION") });
    await advance(0);
    expect(controller.getSnapshot().list.page?.items[0]).toMatchObject({ key: "ANNOUNCEMENT-0" });
    expect(counted()).toBe(1);
  });

  it("uses 45 seconds while open or while a critical or attention count is known, 120 otherwise (A06)", async () => {
    const { controller, advance, counted, answerCountWith } = setup();
    answerCountWith({ ok: true, data: counts(1, { critical: 1 }) });
    controller.start({ coreReady: true });
    await advance(0);
    await advance(45_000);
    expect(counted()).toBe(2);
    answerCountWith({ ok: true, data: counts(1) });
    await advance(45_000);
    expect(counted()).toBe(3); // the critical condition cleared on this answer
    await advance(100_000);
    expect(counted()).toBe(3);
    await advance(20_000);
    expect(counted()).toBe(4);
  });

  it("joins repeated triggers to the read in flight (A07)", async () => {
    const { controller, advance, calls, counted } = setup({ hold: true });
    controller.start({ coreReady: true });
    await advance(0);
    controller.retry();
    controller.retry();
    controller.setOpen(true);
    expect(counted()).toBe(1);
    calls[0].release({ ok: true, data: counts(0) });
    await advance(0);
  });

  it("gives up a slow read at eight seconds and backs off 15, 30, 60, 120 (A07)", async () => {
    const { controller, advance, calls, counted } = setup({ hold: true });
    controller.start({ coreReady: true });
    await advance(0);
    await advance(8_000);
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].release({ ok: false, status: 0 });
    await advance(0);
    await advance(14_900);
    expect(counted()).toBe(1);
    await advance(200);
    expect(counted()).toBe(2);
    calls[1].release({ ok: false, status: 503 });
    await advance(0);
    await advance(29_000);
    expect(counted()).toBe(2);
    await advance(1_500);
    expect(counted()).toBe(3);
  });

  it("honours a longer Retry-After on a 429 (A08)", async () => {
    const { controller, advance, counted, answerCountWith } = setup();
    answerCountWith({ ok: false, status: 429, retryAfterMs: 90_000 });
    controller.start({ coreReady: true });
    await advance(0);
    await advance(89_000);
    expect(counted()).toBe(1);
    await advance(2_000);
    expect(counted()).toBe(2);
  });

  it("a 401 clears what it held, stops, and asks for sign-in once (A08)", async () => {
    const { controller, advance, counted, answerCountWith, events } = setup();
    controller.start({ coreReady: true });
    await advance(0);
    answerCountWith({ ok: false, status: 401 });
    await advance(120_000);
    expect(controller.getSnapshot().count.value).toBeNull();
    expect(controller.getSnapshot().suspended).toBe(true);
    await advance(10 * 60_000);
    expect(counted()).toBe(2);
    expect(events.unauthenticated).toBe(1);
  });

  it("an answer for another context is dropped, clears content and reconciles once (RUNTIME-02)", async () => {
    const { controller, advance, answerCountWith, events, counted } = setup();
    answerCountWith({ ok: true, data: counts(9), contextKey: "ctx-b" });
    controller.start({ coreReady: true });
    await advance(0);
    expect(controller.getSnapshot().count.value).toBeNull();
    await advance(10 * 60_000);
    expect(events.mismatch).toBe(1);
    expect(counted()).toBe(1);
  });

  it("a first failure is an unknown count, never zero; a later failure keeps the last value as stale (A09)", async () => {
    const { controller, advance, answerCountWith } = setup();
    answerCountWith({ ok: false, status: 500 });
    controller.start({ coreReady: true });
    await advance(0);
    expect(controller.getSnapshot().count).toEqual({ value: null, stale: false, failed: true });
    answerCountWith({ ok: true, data: counts(3, { critical: 1 }) });
    await advance(15_000);
    expect(controller.getSnapshot().count.value?.critical).toBe(1);
    answerCountWith({ ok: false, status: 500 });
    await advance(45_000);
    expect(controller.getSnapshot().count).toMatchObject({ stale: true, failed: true, value: { critical: 1 } });
  });

  it("a read asked before a mutation cannot answer for it (A11)", async () => {
    const { controller, advance, calls, counted } = setup({ hold: true });
    controller.start({ coreReady: true });
    await advance(0);
    controller.beginMutation();
    controller.changed();
    calls[0].release({ ok: true, data: counts(5) }); // the old answer
    await advance(0);
    expect(controller.getSnapshot().count.value).toBeNull();
    expect(counted()).toBe(2); // one follow-up
    calls[1].release({ ok: true, data: counts(4) });
    await advance(2_000);
    expect(controller.getSnapshot().count.value?.total).toBe(4);
    expect(counted()).toBe(2);
  });

  it("batches a burst of changes: at most one start a second, and a trailing one (A12)", async () => {
    const { controller, advance, counted } = setup();
    controller.start({ coreReady: true });
    await advance(0);
    for (let index = 0; index < 20; index += 1) {
      controller.changed();
      await advance(100);
    }
    await advance(2_000);
    expect(counted()).toBeLessThanOrEqual(4);
    expect(counted()).toBeGreaterThanOrEqual(3);
  });

  it("keeps an oversized page while shown, whole, without caching it past its turn (A16)", async () => {
    const clock = fakeEnvironment();
    const big = page("ALL", 3000);
    const controller = createActivityController({
      contextKey: "ctx",
      environment: clock.env,
      transport: { count: async () => ({ ok: true, data: counts(0) }), list: async () => ({ ok: true, data: big }) },
    });
    controller.start({ coreReady: true });
    controller.setOpen(true);
    await clock.advance(0);
    expect(controller.getSnapshot().list.page?.items).toHaveLength(3000);
  });

  it("dispose stops every timer", async () => {
    const { controller, advance, counted } = setup();
    controller.start({ coreReady: true });
    await advance(0);
    controller.dispose();
    await advance(10 * 60_000);
    expect(counted()).toBe(1);
  });
});
