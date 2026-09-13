/**
 * Runtime metrics (PRD #38 §97, §105-§108).
 *
 * Counters live in process memory and are exposed in the Prometheus text
 * format by `/api/internal/metrics`, so each instance is scraped on its own and
 * the monitoring system does the summing. Gauges that describe shared state — a
 * backlog, the age of the oldest pending event — are not kept here at all: they
 * are read from the database at scrape time, because every instance would
 * otherwise report its own stale copy of the same number.
 *
 * Label values must be low-cardinality and never personal: a template key or a
 * worker name, not a recipient or a company id.
 */

export const Metric = {
  MAIL_SEND_SUCCESS: "mail_send_success_count",
  MAIL_SEND_FAILURE: "mail_send_failure_count",
  MAIL_RETRY: "mail_retry_count",
  MAIL_SUPPRESSED: "mail_suppressed_count",
  NOTIFICATION_DISPATCH_SUCCESS: "notification_dispatch_success_count",
  NOTIFICATION_DISPATCH_FAILURE: "notification_dispatch_failure_count",
  UPLOAD_FINALIZE_FAILURE: "upload_finalize_failure_count",
  SCAN_FAILURE: "scan_failure_count",
  PREVIEW_FAILURE: "preview_failure_count",
  ORPHAN_DETECTED: "orphan_detected_count",
  RATE_LIMIT_TRIGGERED: "rate_limit_triggered_count",
  WORKER_JOB_SUCCESS: "worker_job_success_count",
  WORKER_JOB_FAILURE: "worker_job_failure_count",
  SEARCH_FAILURE: "search_provider_failure_count",
} as const;

export type MetricName = (typeof Metric)[keyof typeof Metric];

type Labels = Record<string, string>;

const counters = new Map<string, { name: MetricName; labels: Labels; value: number }>();

function seriesKey(name: string, labels: Labels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`);
  return `${name}{${parts.join(",")}}`;
}

export function incrementCounter(name: MetricName, labels: Labels = {}, by = 1): void {
  const key = seriesKey(name, labels);
  const existing = counters.get(key);
  if (existing) existing.value += by;
  else counters.set(key, { name, labels, value: by });
}

export type CounterSample = { name: MetricName; labels: Labels; value: number };

export function counterSamples(): CounterSample[] {
  return [...counters.values()].map((sample) => ({ ...sample, labels: { ...sample.labels } }));
}

export function counterValue(name: MetricName, labels: Labels = {}): number {
  return counters.get(seriesKey(name, labels))?.value ?? 0;
}

/** Test seam: counters are per-process and survive between tests otherwise. */
export function resetMetrics(): void {
  counters.clear();
}

export type GaugeSample = { name: string; labels?: Labels; value: number; help?: string };

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(labels: Labels | undefined): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

/** The Prometheus text exposition of every counter plus the supplied gauges. */
export function renderPrometheus(gauges: GaugeSample[] = []): string {
  const lines: string[] = [];
  const byName = new Map<string, CounterSample[]>();
  for (const sample of counterSamples()) {
    byName.set(sample.name, [...(byName.get(sample.name) ?? []), sample]);
  }

  for (const [name, samples] of byName) {
    lines.push(`# TYPE ${name} counter`);
    for (const sample of samples) lines.push(`${name}${formatLabels(sample.labels)} ${sample.value}`);
  }

  const gaugeNames = new Set<string>();
  for (const gauge of gauges) {
    if (!gaugeNames.has(gauge.name)) {
      if (gauge.help) lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      gaugeNames.add(gauge.name);
    }
    lines.push(`${gauge.name}${formatLabels(gauge.labels)} ${gauge.value}`);
  }

  return `${lines.join("\n")}\n`;
}
