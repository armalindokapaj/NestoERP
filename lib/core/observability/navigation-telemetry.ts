import { z } from "zod";

import { incrementCounter, Metric, observeHistogram } from "@/lib/core/observability/metrics";

/**
 * Browser navigation telemetry (NAV-03 §11, TELEMETRY-01..04).
 *
 * Sampled browsers send batches of observations: fixed enums and bounded
 * numbers only. No names, emails, ids, URLs, query strings, search text,
 * titles, permissions, context keys, error text or stacks can be expressed —
 * every object is strict, so an unknown property rejects the batch. Nothing
 * here writes a row or affects access: accepted events only move bounded
 * in-memory counters and histograms, scraped through the protected metrics
 * endpoint. A release label comes from the server, never the payload.
 */

export const TELEMETRY_MAX_BYTES = 16 * 1024;
export const TELEMETRY_MAX_EVENTS = 20;

const route = z.enum(["dashboard", "projects", "clients", "tasks", "finance", "other"]);
const outcome = z.enum(["success", "partial_failure", "error", "timeout", "superseded", "abandoned", "backgrounded"]);
const duration = z.number().finite().min(0).max(60_000);

const navigation = z
  .object({
    kind: z.literal("navigation"),
    route,
    stage: z.enum(["feedback", "commit", "core", "primary", "settled"]),
    navigationKind: z.enum(["document", "spa", "history", "workspace"]),
    outcome,
    durationMs: duration.optional(),
    preparation: z.enum(["issued", "not_issued", "unknown"]).optional(),
    device: z.enum(["compact", "wide"]).optional(),
  })
  .strict()
  // A successful stage has a duration; anything else is an outcome without one.
  .refine((event) => (event.outcome === "success" || event.outcome === "partial_failure") === (event.durationMs !== undefined), { message: "duration" });

const panel = z
  .object({
    kind: z.literal("panel"),
    route,
    surface: z.enum(["search", "quick_create", "activity", "workspace"]),
    stage: z.enum(["feedback", "ready"]),
    outcome: z.enum(["success", "error", "timeout", "superseded", "abandoned"]),
    durationMs: duration.optional(),
    cache: z.enum(["cold", "warm", "unknown"]),
    device: z.enum(["compact", "wide"]).optional(),
  })
  .strict()
  .refine((event) => (event.outcome === "success") === (event.durationMs !== undefined), { message: "duration" });

const webVital = z.discriminatedUnion("metric", [
  z.object({ kind: z.literal("web_vital"), route, metric: z.enum(["LCP", "INP", "FCP", "TTFB"]), value: duration, outcome: z.literal("success"), device: z.enum(["compact", "wide"]) }).strict(),
  z.object({ kind: z.literal("web_vital"), route, metric: z.literal("CLS"), value: z.number().finite().min(0).max(10), outcome: z.literal("success"), device: z.enum(["compact", "wide"]) }).strict(),
]);

const requestSummary = z
  .object({
    kind: z.literal("request_summary"),
    route,
    requestFamily: z.enum(["activity_count", "activity_list", "search", "search_home", "quick_create", "route"]),
    requestCount: z.number().int().min(0).max(1_000),
    outcome: z.literal("success"),
  })
  .strict();

export const navigationBatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    events: z.array(z.union([navigation, panel, webVital, requestSummary])).min(1).max(TELEMETRY_MAX_EVENTS),
  })
  .strict();

export type NavigationBatch = z.infer<typeof navigationBatchSchema>;

/** Folds an accepted batch into the process's counters and histograms. */
export function ingestNavigationBatch(batch: NavigationBatch): void {
  for (const event of batch.events) {
    switch (event.kind) {
      case "navigation":
        incrementCounter(Metric.NAVIGATION_OUTCOME, { route: event.route, stage: event.stage, outcome: event.outcome });
        // Only successful stages are latencies; the rest stay in the outcome counts.
        if (event.outcome === "success" && event.durationMs !== undefined) {
          observeHistogram("navigation_duration_ms", { route: event.route, stage: event.stage, kind: event.navigationKind }, event.durationMs);
        }
        break;
      case "panel":
        incrementCounter(Metric.PANEL_OUTCOME, { panel: event.surface, stage: event.stage, outcome: event.outcome });
        if (event.outcome === "success" && event.stage === "ready" && event.durationMs !== undefined) {
          observeHistogram("panel_ready_ms", { panel: event.surface, cache: event.cache }, event.durationMs);
        }
        break;
      case "web_vital":
        if (event.metric === "CLS") observeHistogram("web_vital_cls", { device: event.device }, event.value);
        else observeHistogram("web_vital", { metric: event.metric, device: event.device }, event.value);
        break;
      case "request_summary":
        incrementCounter(Metric.REQUEST_SUMMARY, { family: event.requestFamily }, event.requestCount);
        break;
    }
  }
}

/**
 * Per-instance ceiling on accepted batches, whatever the sessions: rotating
 * sessions cannot grow the work without bound. Not a global limit — each
 * instance keeps its own; a deployment's edge sets the aggregate (TELEMETRY-03).
 */
const INSTANCE_BATCHES_PER_MINUTE = 1_200;
const instance = globalThis as unknown as { __nestoTelemetryWindow?: { start: number; count: number } };

export function admitInstanceBatch(now = Date.now()): boolean {
  const window = (instance.__nestoTelemetryWindow ??= { start: now, count: 0 });
  if (now - window.start >= 60_000) {
    window.start = now;
    window.count = 0;
  }
  window.count += 1;
  return window.count <= INSTANCE_BATCHES_PER_MINUTE;
}

/** Whether ingestion is on for this deployment (TELEMETRY-02). */
export function telemetryIngestionEnabled(): boolean {
  return process.env.NESTO_NAV_TELEMETRY !== "off";
}

/** Times one of the bell's reads into `activity_read_ms` (NAV-03 §11); the result or error passes through. */
export async function timeActivityRead<T>(family: "count" | "list", read: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await read();
    observeHistogram("activity_read_ms", { family, outcome: "success" }, performance.now() - started);
    return result;
  } catch (error) {
    observeHistogram("activity_read_ms", { family, outcome: "failure" }, performance.now() - started);
    throw error;
  }
}
