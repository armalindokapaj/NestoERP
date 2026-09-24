"use client";

import * as React from "react";

import { captureDocumentStages } from "@/lib/navigation/telemetry-registry";

/**
 * Decides once per document whether it records navigation telemetry (NAV-03
 * TELEMETRY-02), at the server's sample rate. An unsampled document does
 * nothing more: no observer, no timer, and none of the recorder's code (Web
 * Vitals, the queue, the transport), which only a sampled document downloads
 * (PERF-02 new telemetry JS). A sampled one starts timing its own load at
 * once, then loads the recorder, which takes the timings over.
 */

const PerformanceRecorder = React.lazy(() => import("@/components/navigation/performance-recorder").then((loaded) => ({ default: loaded.PerformanceRecorder })));

let sampled: boolean | null = null;

export function PerformanceGate({ sampleRate }: { sampleRate: number }) {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    sampled ??= Math.random() < sampleRate;
    if (!sampled) return;
    captureDocumentStages();
    setOn(true);
  }, [sampleRate]);
  if (!on) return null;
  return (
    <React.Suspense fallback={null}>
      <PerformanceRecorder />
    </React.Suspense>
  );
}
