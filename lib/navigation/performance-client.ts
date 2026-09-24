/**
 * The sampled performance recorder (NAV-03 §10, §11: MEASURE-01..03,
 * TELEMETRY-02).
 *
 * One per sampled document (10 % by default, chosen once, no identifier
 * kept); only a sampled document downloads this module (see
 * `telemetry-registry.ts`). It keeps at most 100 events in memory, sends
 * batches of at most 20 events and 16 KiB, at most twice a minute while
 * visible, and one last best-effort batch when the page is hidden. It never
 * retries, queues offline, shows anything, or holds up navigation; a failed
 * send is dropped. Only fixed enums and rounded numbers leave the browser: a
 * route is reduced to its module family before anything is recorded.
 */

import { NOOP_RECORDER, type Recorder, type TelemetryEvent } from "@/lib/navigation/telemetry-registry";

export {
  activeRecorder,
  deviceClass,
  recordPanelReady,
  routeFamily,
  setActiveRecorder,
  type Device,
  type Recorder,
  type RouteFamily,
  type TelemetryEvent,
} from "@/lib/navigation/telemetry-registry";

export const MAX_QUEUE = 100;
export const MAX_BATCH_EVENTS = 20;
export const MAX_BATCH_BYTES = 16 * 1024;
export const FLUSH_INTERVAL_MS = 30_000;
export const MAX_BACKGROUND_SENDS_PER_MINUTE = 2;
export const ENDPOINT = "/api/telemetry/navigation";

export type TransportFn = (body: string, final: boolean) => void;

export function createRecorder(options: { sampled: boolean; transport: TransportFn; now?: () => number; schedule?: (run: () => void, ms: number) => () => void; visible?: () => boolean }): Recorder {
  if (!options.sampled) return NOOP_RECORDER;
  const now = options.now ?? (() => Date.now());
  const visible = options.visible ?? (() => typeof document === "undefined" || document.visibilityState === "visible");
  const queue: TelemetryEvent[] = [];
  const sends: number[] = [];
  let droppedCount = 0;
  let finalSent = false;
  let disposed = false;

  const cancelTick = options.schedule?.(function tick() {
    if (!disposed && visible()) flush(false);
  }, FLUSH_INTERVAL_MS);

  function take(): TelemetryEvent[] {
    const batch: TelemetryEvent[] = [];
    let bytes = 30;
    while (queue.length && batch.length < MAX_BATCH_EVENTS) {
      const size = JSON.stringify(queue[0]).length + 1;
      if (bytes + size > MAX_BATCH_BYTES) break;
      bytes += size;
      batch.push(queue.shift()!);
    }
    return batch;
  }

  function flush(final = false) {
    if (disposed || queue.length === 0) return;
    if (final) {
      if (finalSent) return;
      finalSent = true;
    } else {
      // Visible again: the next time the page is hidden may send one final batch too.
      finalSent = false;
      const at = now();
      while (sends.length && at - sends[0] >= 60_000) sends.shift();
      if (sends.length >= MAX_BACKGROUND_SENDS_PER_MINUTE) return;
      sends.push(at);
    }
    const batch = take();
    if (batch.length) options.transport(JSON.stringify({ schemaVersion: 1, events: batch }), final);
  }

  return {
    sampled: true,
    record(event) {
      if (disposed) return;
      const rounded = { ...event } as TelemetryEvent & { durationMs?: number; value?: number };
      if (typeof rounded.durationMs === "number") rounded.durationMs = Math.min(60_000, Math.max(0, Math.round(rounded.durationMs)));
      if (rounded.kind === "web_vital") rounded.value = rounded.metric === "CLS" ? Math.round(rounded.value * 1000) / 1000 : Math.min(60_000, Math.max(0, Math.round(rounded.value)));
      queue.push(rounded);
      while (queue.length > MAX_QUEUE) {
        queue.shift();
        droppedCount += 1;
      }
      if (queue.length >= MAX_BATCH_EVENTS && visible()) flush(false);
    },
    flush,
    dropped: () => droppedCount,
    dispose() {
      disposed = true;
      cancelTick?.();
      queue.length = 0;
    },
  };
}

/** Same-origin, keepalive, never awaited, never retried (TELEMETRY-02). */
export const fetchTransport: TransportFn = (body) => {
  try {
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true, credentials: "same-origin", headers: { "content-type": "application/json" } }).catch(() => undefined);
  } catch {
    // Dropped.
  }
};
