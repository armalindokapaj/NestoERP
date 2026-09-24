import { beforeEach, describe, expect, it } from "vitest";

import { counterValue, histogramSeriesBudget, HISTOGRAMS, Metric, observeHistogram, renderPrometheus, resetHistograms, resetMetrics, type HistogramName } from "@/lib/core/observability/metrics";
import { ingestNavigationBatch, navigationBatchSchema, timeActivityRead } from "@/lib/core/observability/navigation-telemetry";
import { createRecorder, MAX_BATCH_EVENTS, MAX_QUEUE, routeFamily, type TelemetryEvent } from "@/lib/navigation/performance-client";

/** NAV-03 §11: the event contract, histograms, the series budget and the recorder's bounds. */

beforeEach(() => {
  resetMetrics();
  resetHistograms();
});

const navigationEvent = { kind: "navigation", route: "tasks", stage: "primary", navigationKind: "spa", outcome: "success", durationMs: 420 } as const;

describe("the event contract (T07, T08, T11)", () => {
  it("accepts fixed enums and bounded numbers", () => {
    expect(navigationBatchSchema.safeParse({ schemaVersion: 1, events: [navigationEvent, { kind: "web_vital", route: "dashboard", metric: "CLS", value: 0.05, outcome: "success", device: "wide" }, { kind: "panel", route: "other", surface: "search", stage: "ready", outcome: "success", durationMs: 90, cache: "cold" }] }).success).toBe(true);
  });

  it("rejects anything that could carry an identifier, a URL or text", () => {
    const bad = [
      { ...navigationEvent, url: "/tasks/abc" },
      { ...navigationEvent, route: "tasks/abc" },
      { ...navigationEvent, route: "admin" },
      { ...navigationEvent, contextKey: "k" },
      { ...navigationEvent, durationMs: -1 },
      { ...navigationEvent, durationMs: Number.POSITIVE_INFINITY },
      { ...navigationEvent, durationMs: 60_001 },
      { ...navigationEvent, outcome: "timeout" }, // a timeout carries no latency
      { kind: "request_summary", route: "tasks", requestFamily: "search", requestCount: 1_001, outcome: "success" },
      { kind: "web_vital", route: "tasks", metric: "LCP", value: 100, outcome: "success", device: "wide", stage: "core" },
    ];
    for (const event of bad) expect(navigationBatchSchema.safeParse({ schemaVersion: 1, events: [event] }).success, JSON.stringify(event)).toBe(false);
    expect(navigationBatchSchema.safeParse({ schemaVersion: 1, events: [], extra: 1 }).success).toBe(false);
    expect(navigationBatchSchema.safeParse({ schemaVersion: 1, events: Array.from({ length: 21 }, () => navigationEvent) }).success).toBe(false);
  });

  it("reduces a path to its module family, and nothing else", () => {
    expect(["/dashboard", "/projects/p1/units", "/clients/c9", "/tasks?tab=mine", "/finance/invoices", "/hr", "/"].map((path) => routeFamily(path.split("?")[0]))).toEqual(["dashboard", "projects", "clients", "tasks", "finance", "other", "other"]);
  });
});

describe("histograms (T10, T11)", () => {
  it("exports cumulative buckets, +Inf, sum and count", () => {
    for (const value of [20, 120, 120, 800, 70_000]) observeHistogram("navigation_duration_ms", { route: "tasks", stage: "primary", kind: "spa" }, value);
    const text = renderPrometheus();
    expect(text).toContain("# TYPE navigation_duration_ms histogram");
    expect(text).toContain('navigation_duration_ms_bucket{route="tasks",stage="primary",kind="spa",le="25"} 1');
    expect(text).toContain('navigation_duration_ms_bucket{route="tasks",stage="primary",kind="spa",le="150"} 3');
    expect(text).toContain('navigation_duration_ms_bucket{route="tasks",stage="primary",kind="spa",le="1000"} 4');
    expect(text).toContain('navigation_duration_ms_bucket{route="tasks",stage="primary",kind="spa",le="+Inf"} 5');
    expect(text).toContain('navigation_duration_ms_count{route="tasks",stage="primary",kind="spa"} 5');
    expect(text).toContain('navigation_duration_ms_sum{route="tasks",stage="primary",kind="spa"} 71060');
  });

  it("times the bell's reads by family and outcome, passing the result or error through", async () => {
    await expect(timeActivityRead("count", async () => 7)).resolves.toBe(7);
    await expect(timeActivityRead("list", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    const text = renderPrometheus();
    expect(text).toContain('activity_read_ms_count{family="count",outcome="success"} 1');
    expect(text).toContain('activity_read_ms_count{family="list",outcome="failure"} 1');
  });

  it("drops a value or label outside its declared set instead of adding a series", () => {
    expect(observeHistogram("panel_ready_ms", { panel: "search", cache: "cold" }, 10)).toBe(true);
    expect(observeHistogram("panel_ready_ms", { panel: "evil" as "search", cache: "cold" }, 10)).toBe(false);
    expect(observeHistogram("panel_ready_ms", { panel: "search", cache: "cold", extra: "x" } as never, 10)).toBe(false);
    expect(observeHistogram("panel_ready_ms", { panel: "search", cache: "cold" }, Number.NaN)).toBe(false);
    expect(renderPrometheus().match(/panel_ready_ms_count/g)).toHaveLength(1);
  });

  it("stays inside the 4,000-series budget however the labels combine", () => {
    const total = (Object.keys(HISTOGRAMS) as HistogramName[]).reduce((sum, name) => sum + histogramSeriesBudget(name), 0);
    expect(total).toBeLessThanOrEqual(4_000);
  });

  it("counts failed stages as outcomes, never as fast latencies", () => {
    ingestNavigationBatch({ schemaVersion: 1, events: [navigationEvent, { kind: "navigation", route: "tasks", stage: "primary", navigationKind: "spa", outcome: "timeout" }] });
    expect(counterValue(Metric.NAVIGATION_OUTCOME, { route: "tasks", stage: "primary", outcome: "timeout" })).toBe(1);
    expect(renderPrometheus()).toContain('navigation_duration_ms_count{route="tasks",stage="primary",kind="spa"} 1');
  });
});

describe("the recorder (T05, T06)", () => {
  const event: TelemetryEvent = { kind: "navigation", route: "tasks", stage: "core", navigationKind: "spa", outcome: "success", durationMs: 100 };

  it("an unsampled document records and sends nothing", () => {
    const sent: string[] = [];
    const recorder = createRecorder({ sampled: false, transport: (body) => sent.push(body) });
    for (let index = 0; index < 50; index += 1) recorder.record(event);
    recorder.flush(true);
    expect(recorder.sampled).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("keeps at most 100 events, sends batches of at most 20, twice a minute, and one final batch", () => {
    let now = 0;
    const sent: string[] = [];
    const recorder = createRecorder({ sampled: true, transport: (body) => sent.push(body), now: () => now, visible: () => false });
    for (let index = 0; index < 130; index += 1) recorder.record(event);
    expect(recorder.dropped()).toBe(130 - MAX_QUEUE);
    recorder.flush();
    recorder.flush();
    recorder.flush();
    expect(sent).toHaveLength(2);
    recorder.flush(true);
    recorder.flush(true);
    expect(sent).toHaveLength(3);
    for (const body of sent) expect((JSON.parse(body) as { events: unknown[] }).events.length).toBeLessThanOrEqual(MAX_BATCH_EVENTS);
    now = 61_000;
    recorder.flush();
    expect(sent).toHaveLength(4);
  });
});
