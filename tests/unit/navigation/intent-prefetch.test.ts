import { describe, expect, it } from "vitest";

import { createIntentScheduler, intentRoute, type IntentEnvironment, type IntentRoute } from "@/lib/navigation/intent-prefetch";

function setup(overrides: Partial<{ allowed: boolean; busy: boolean; path: string }> = {}) {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const state = { allowed: true, busy: false, path: "/tasks", ...overrides };
  const environment: IntentEnvironment = {
    now: () => now,
    setTimeout: (run, ms) => {
      id += 1;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
    allowed: () => state.allowed,
    busy: () => state.busy,
    currentPath: () => state.path,
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].run();
    }
    now = end;
  };
  const issued: Array<{ route: IntentRoute; at: number }> = [];
  const scheduler = createIntentScheduler({ prefetch: (route) => issued.push({ route, at: now }), environment, contextKey: "ctx-a" });
  return { scheduler, advance, issued, state };
}

describe("the approved destinations (PREFETCH-02)", () => {
  it("accepts the five exact paths only", () => {
    expect(["/dashboard", "/projects", "/clients", "/tasks", "/finance"].map((href) => intentRoute(href))).toEqual(["/dashboard", "/projects", "/clients", "/tasks", "/finance"]);
    for (const href of ["/projects/abc", "/finance/invoices", "/tasks?tab=mine", "/clients#top", "//evil.test/dashboard", "https://evil.test/dashboard", "/api/tasks", "/tasks/export", "/notifications/1/open"]) {
      expect(intentRoute(href, "http://localhost"), href).toBeNull();
    }
    expect(intentRoute("http://localhost/tasks", "http://localhost")).toBe("/tasks");
  });
});

describe("the intent scheduler (PREFETCH-03)", () => {
  it("issues once after a 150 ms hover or a 100 ms focus (F01)", () => {
    const { scheduler, advance, issued } = setup();
    scheduler.intent("/projects", "hover");
    advance(149);
    expect(issued).toHaveLength(0);
    advance(1);
    expect(issued.map((entry) => entry.route)).toEqual(["/projects"]);
    scheduler.intent("/clients", "focus");
    advance(100);
    advance(1_500);
    expect(issued.map((entry) => entry.route)).toEqual(["/projects", "/clients"]);
  });

  it("cancels on leave before the dwell, keeps one candidate, and holds 1.5 s spacing and four a minute (F02)", () => {
    const { scheduler, advance, issued } = setup();
    scheduler.intent("/projects", "hover");
    advance(100);
    scheduler.leave("/projects");
    advance(1_000);
    expect(issued).toHaveLength(0);
    // Sweeping across links: only the last resting one counts.
    for (const route of ["/dashboard", "/projects", "/clients", "/finance"] as IntentRoute[]) {
      scheduler.intent(route, "hover");
      advance(50);
    }
    advance(200);
    expect(issued.map((entry) => entry.route)).toEqual(["/finance"]);
    for (const route of ["/dashboard", "/projects", "/clients", "/dashboard"] as IntentRoute[]) {
      scheduler.intent(route, "hover");
      advance(160);
    }
    advance(10_000);
    const gaps = issued.slice(1).map((entry, index) => entry.at - issued[index].at);
    expect(gaps.every((gap) => gap >= 1_500)).toBe(true);
    expect(issued.filter((entry) => entry.at < 60_000).length).toBeLessThanOrEqual(4);
  });

  it("issues nothing while hidden, offline, on Save-Data or while a navigation is pending (F03)", () => {
    const hidden = setup({ allowed: false });
    hidden.scheduler.intent("/projects", "hover");
    hidden.advance(5_000);
    expect(hidden.issued).toHaveLength(0);
    const busy = setup({ busy: true });
    busy.scheduler.intent("/projects", "hover");
    busy.advance(5_000);
    expect(busy.issued).toHaveLength(0);
  });

  it("skips the current destination and anything issued in the last minute for this context", () => {
    const { scheduler, advance, issued } = setup({ path: "/projects" });
    scheduler.intent("/projects", "hover");
    advance(200);
    expect(issued).toHaveLength(0);
    scheduler.intent("/clients", "hover");
    advance(200);
    scheduler.intent("/clients", "hover");
    advance(5_000);
    expect(issued.map((entry) => entry.route)).toEqual(["/clients"]);
    advance(60_000);
    scheduler.intent("/clients", "hover");
    advance(200);
    expect(issued.map((entry) => entry.route)).toEqual(["/clients", "/clients"]);
  });

  it("a changed context forgets its records and drops unissued work (PREFETCH-05)", () => {
    const { scheduler, advance, issued } = setup();
    scheduler.intent("/clients", "hover");
    advance(200);
    scheduler.intent("/dashboard", "hover");
    advance(160); // queued behind the 1.5 s gap
    scheduler.reset("ctx-b");
    advance(5_000);
    expect(issued.map((entry) => entry.route)).toEqual(["/clients"]);
    scheduler.intent("/clients", "hover");
    advance(200);
    expect(issued.map((entry) => entry.route)).toEqual(["/clients", "/clients"]);
  });

  it("never refills by itself: a failed or invalidated issue needs a new intent (F06)", () => {
    const { scheduler, advance, issued } = setup();
    scheduler.intent("/tasks", "hover");
    advance(200);
    advance(10 * 60_000);
    expect(issued).toHaveLength(0); // /tasks is the current page
    scheduler.intent("/finance", "hover");
    advance(200);
    advance(10 * 60_000);
    expect(issued).toHaveLength(1);
  });
});
