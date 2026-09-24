"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { createRecorder, fetchTransport } from "@/lib/navigation/performance-client";
import { activeRecorder, captureDocumentStages, deviceClass, readPageStages, routeFamily, setActiveRecorder, type Recorder, type RouteFamily } from "@/lib/navigation/telemetry-registry";

/**
 * Navigation stages and Web Vitals for a sampled document (NAV-03 §10,
 * MEASURE-01..03).
 *
 * A navigation is NAV-01's ticket: it starts when the app accepted the
 * navigation and ends each stage once:
 * - feedback: the next frame after acceptance, when the pending mark paints;
 * - commit: the pathname changed;
 * - core: the route's loading skeleton is gone from the main region;
 * - primary: the page's `data-section="primary"` section is present with no
 *   placeholder left inside it;
 * - settled: no section placeholder is left; a section error makes it a
 *   partial failure.
 * A newer navigation supersedes an unfinished one, a hidden page makes it
 * backgrounded, and 60 s without settling records a timeout. The document
 * load itself is measured from the navigation start the same way, from the
 * stages `captureDocumentStages` saw before this code arrived.
 *
 * Mounted only in a sampled document, by `PerformanceGate`.
 */

const TIMEOUT_MS = 60_000;

type Tracking = {
  startedAt: number;
  route: RouteFamily;
  kind: "document" | "spa";
  done: Set<string>;
  timer: number;
};

function record(recorder: Recorder, tracking: Tracking, stage: "feedback" | "commit" | "core" | "primary" | "settled", outcome: "success" | "partial_failure" | "timeout" | "superseded" | "backgrounded" = "success", at = performance.now()) {
  if (tracking.done.has(stage)) return;
  tracking.done.add(stage);
  const measured = outcome === "success" || outcome === "partial_failure";
  recorder.record({
    kind: "navigation",
    route: tracking.route,
    stage,
    navigationKind: tracking.kind,
    outcome,
    durationMs: measured ? at - tracking.startedAt : undefined,
    device: deviceClass(window.innerWidth),
  });
}

export function PerformanceRecorder() {
  const feedback = useNavigationFeedback();
  const pathname = usePathname();
  const [recorder] = React.useState(() => {
    // Once per document: a later mount reuses the recorder already made.
    const existing = activeRecorder();
    if (existing.sampled) return existing;
    const created = createRecorder({
      sampled: true,
      transport: fetchTransport,
      schedule: (run, ms) => {
        const handle = window.setInterval(run, ms);
        return () => window.clearInterval(handle);
      },
    });
    setActiveRecorder(created);
    return created;
  });
  const tracking = React.useRef<Tracking | null>(null);

  // Web Vitals, in their own document lifecycle; one latest sample per metric id.
  const seen = React.useRef(new Map<string, number>());
  const onVital = React.useCallback(
    (metric: { id: string; name: string; value: number }) => {
      if (!recorder.sampled) return;
      if (!["LCP", "INP", "CLS", "FCP", "TTFB"].includes(metric.name)) return;
      if (seen.current.get(metric.id) === metric.value) return;
      seen.current.set(metric.id, metric.value);
      if (seen.current.size > 50) seen.current.delete(seen.current.keys().next().value as string);
      recorder.record({ kind: "web_vital", route: routeFamily(window.location.pathname), metric: metric.name as "LCP", value: metric.value, outcome: "success", device: deviceClass(window.innerWidth) });
    },
    [recorder],
  );
  useReportWebVitals(onVital);

  const finish = React.useCallback(
    (outcome?: "superseded" | "backgrounded" | "timeout") => {
      const current = tracking.current;
      if (!current) return;
      window.clearTimeout(current.timer);
      if (outcome) record(recorder, current, "settled", outcome);
      tracking.current = null;
    },
    [recorder],
  );

  const begin = React.useCallback(
    (kind: "document" | "spa", startedAt: number, route: RouteFamily) => {
      finish("superseded");
      const next: Tracking = { startedAt, route, kind, done: new Set(), timer: window.setTimeout(() => finish("timeout"), TIMEOUT_MS) };
      tracking.current = next;
      if (kind === "spa") requestAnimationFrame(() => tracking.current === next && record(recorder, next, "feedback"));
    },
    [finish, recorder],
  );

  // Readiness from the page's own markers, checked on each change to the main region.
  const check = React.useCallback(() => {
    const current = tracking.current;
    const main = document.getElementById("nesto-main");
    if (!current || !main || (current.kind === "spa" && !current.done.has("commit"))) return;
    const stages = readPageStages(main);
    if (!stages.core) return;
    record(recorder, current, "core");
    if (stages.primary) record(recorder, current, "primary");
    if (stages.settled) {
      record(recorder, current, "settled", stages.partial ? "partial_failure" : "success");
      finish();
    }
  }, [finish, recorder]);

  React.useEffect(() => {
    if (!recorder.sampled) return;
    // The document load: what was seen before this code arrived keeps its own time.
    const seen = captureDocumentStages();
    begin("document", 0, seen.route);
    const document_ = tracking.current!;
    if (seen.core !== undefined) record(recorder, document_, "core", "success", seen.core);
    if (seen.primary !== undefined) record(recorder, document_, "primary", "success", seen.primary);
    if (seen.settled !== undefined) {
      record(recorder, document_, "settled", seen.partial ? "partial_failure" : "success", seen.settled);
      finish();
    }
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        check();
      });
    };
    const observer = new MutationObserver(schedule);
    const main = document.getElementById("nesto-main");
    if (main) observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-testid", "data-section"] });
    schedule();
    let lastTicket: number | null = null;
    const unsubscribe = feedback?.store.subscribe(() => {
      const ticket = feedback.store.getSnapshot().ticket;
      // The store also changes for its "slow" flag: only a new ticket is a new navigation.
      if (!ticket || ticket.id === lastTicket) return;
      lastTicket = ticket.id;
      begin("spa", performance.now(), routeFamily((ticket.destination ?? window.location.pathname).split("?")[0]));
    });
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        finish("backgrounded");
        recorder.flush(true);
      }
    };
    const onPageHide = () => recorder.flush(true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      observer.disconnect();
      unsubscribe?.();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [recorder, feedback, begin, check, finish]);

  // The committed pathname ends the commit stage of the navigation in flight.
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const current = tracking.current;
    if (!current || current.kind !== "spa") return;
    record(recorder, current, "commit");
    requestAnimationFrame(check);
  }, [pathname, recorder, check]);

  return null;
}
