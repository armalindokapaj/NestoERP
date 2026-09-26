/**
 * The small, always-loaded part of navigation telemetry (NAV-03 §10, §11).
 *
 * Every document carries this: the event types, the document's active
 * recorder (a no-op unless the document was sampled), panel readiness, and
 * the capture of the document load's own stages. The recorder itself, with
 * Web Vitals and the transport, loads only in a sampled document
 * (`components/navigation/performance-gate.tsx`), so the 90 % of documents
 * that record nothing do not download it (PERF-02 new telemetry JS).
 */

export type RouteFamily = "dashboard" | "projects" | "clients" | "tasks" | "finance" | "other";
export type Device = "compact" | "wide";

/** Modules an unsaved-work guard event may name; anything else is "other" (AUD-03 §8). */
export const GUARD_MODULES = [
  "tasks", "finance", "projects", "units", "clients", "sales", "procurement", "documents", "contracts", "hr",
  "engineering", "hse", "inventory", "qaqc", "meetings", "calendar", "timesheets", "daily_logs", "settings",
  "planning", "workforce", "collaboration", "approvals", "announcements", "team", "people", "pricing", "shell", "other",
] as const;
export type GuardModule = (typeof GUARD_MODULES)[number];

export type TelemetryEvent =
  | { kind: "navigation"; route: RouteFamily; stage: "feedback" | "commit" | "core" | "primary" | "settled"; navigationKind: "document" | "spa" | "history" | "workspace"; outcome: "success" | "partial_failure" | "error" | "timeout" | "superseded" | "abandoned" | "backgrounded"; durationMs?: number; preparation?: "issued" | "not_issued" | "unknown"; device?: Device }
  | { kind: "panel"; route: RouteFamily; surface: "search" | "quick_create" | "activity" | "workspace"; stage: "feedback" | "ready"; outcome: "success" | "error" | "timeout" | "superseded" | "abandoned"; durationMs?: number; cache: "cold" | "warm" | "unknown"; device?: Device }
  | { kind: "web_vital"; route: RouteFamily; metric: "LCP" | "INP" | "CLS" | "FCP" | "TTFB"; value: number; outcome: "success"; device: Device }
  | { kind: "request_summary"; route: RouteFamily; requestFamily: "activity_count" | "activity_list" | "search" | "search_home" | "quick_create" | "route"; requestCount: number; outcome: "success" }
  | { kind: "unsaved_guard"; route: RouteFamily; event: "prompt" | "stay" | "discard" | "save" | "save_failed" | "continued" | "duplicate_request" | "duplicate_continuation" | "stale_approval" | "guard_error" | "frozen"; departure: "navigate" | "history" | "dismiss" | "workspace" | "identity" | "reload"; module: GuardModule; durationMs?: number };

export type Recorder = {
  readonly sampled: boolean;
  record(event: TelemetryEvent): void;
  /** Sends what is queued: on a full batch or the 30 s tick while visible, and once on pagehide. */
  flush(final?: boolean): void;
  dropped(): number;
  dispose(): void;
};

export const NOOP_RECORDER: Recorder = { sampled: false, record: () => undefined, flush: () => undefined, dropped: () => 0, dispose: () => undefined };

/** A pathname reduced to its module family; nothing else of the URL is kept. */
export function routeFamily(pathname: string): RouteFamily {
  const first = pathname.split("/")[1] ?? "";
  return first === "dashboard" || first === "projects" || first === "clients" || first === "tasks" || first === "finance" ? first : "other";
}

export function deviceClass(width: number): Device {
  return width < 768 ? "compact" : "wide";
}

/* -------------------------------------------------------------------------- */
/* The document's recorder, for code that reports without a React context.    */
/* -------------------------------------------------------------------------- */

let active: Recorder = NOOP_RECORDER;

export function setActiveRecorder(recorder: Recorder): void {
  active = recorder;
}

export function activeRecorder(): Recorder {
  return active;
}

/** A panel's open-to-ready time; `cold` when its code had to load for this open (MEASURE-01). */
export function recordPanelReady(surface: "search" | "quick_create" | "activity" | "workspace", startedAt: number, cold: boolean, outcome: "success" | "error" = "success"): void {
  if (!active.sampled || typeof window === "undefined") return;
  active.record({
    kind: "panel",
    route: routeFamily(window.location.pathname),
    surface,
    stage: "ready",
    outcome,
    durationMs: outcome === "success" ? performance.now() - startedAt : undefined,
    cache: cold ? "cold" : "warm",
    device: deviceClass(window.innerWidth),
  });
}

/* -------------------------------------------------------------------------- */
/* Page readiness, from the page's own markers                                 */
/* -------------------------------------------------------------------------- */

export type PageStages = { core: boolean; primary: boolean; settled: boolean; partial: boolean };

/**
 * Where the main region stands:
 * - core: the route's loading skeleton is gone;
 * - primary: the `data-section="primary"` section is drawn with no placeholder inside;
 * - settled: no section placeholder is left, and `partial` if a section failed.
 */
export function readPageStages(main: HTMLElement): PageStages {
  const core = !main.querySelector('[data-testid="page-skeleton"]');
  const primary = main.querySelector('[data-section="primary"]');
  const settled = core && !main.querySelector('[data-testid="section-skeleton"]');
  return {
    core,
    primary: core && Boolean(primary) && !primary!.querySelector('[data-testid="section-skeleton"]'),
    settled,
    partial: settled && Boolean(main.querySelector('[data-testid="section-error"]')),
  };
}

/** The document load's stages, as first seen: milliseconds from navigation start. */
export type DocumentStages = { core?: number; primary?: number; settled?: number; partial?: boolean; route: RouteFamily };

let documentStages: DocumentStages | null = null;

/**
 * Starts watching the document load's own stages at once, in a sampled
 * document, so they are timed as they happen and not when the recorder's
 * code has arrived. Stops once the page settles, after 60 s, or when a
 * navigation begins (the recorder takes over from there).
 */
export function captureDocumentStages(): DocumentStages {
  if (documentStages) return documentStages;
  const stages: DocumentStages = { route: routeFamily(window.location.pathname) };
  documentStages = stages;
  const main = document.getElementById("nesto-main");
  if (!main) return stages;
  const startPath = window.location.pathname;
  const check = () => {
    if (window.location.pathname !== startPath) return stop();
    const now = readPageStages(main);
    const at = performance.now();
    if (now.core) stages.core ??= at;
    if (now.primary) stages.primary ??= at;
    if (now.settled) {
      stages.settled ??= at;
      stages.partial = now.partial;
      stop();
    }
  };
  const observer = new MutationObserver(check);
  const timer = window.setTimeout(() => stop(), 60_000);
  function stop() {
    observer.disconnect();
    window.clearTimeout(timer);
  }
  observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-testid", "data-section"] });
  check();
  return stages;
}
