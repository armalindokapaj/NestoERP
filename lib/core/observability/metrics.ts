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
  // Calendar (PRD #39 §197)
  CALENDAR_QUERY: "calendar_query_count",
  CALENDAR_QUERY_DURATION_MS: "calendar_query_duration_ms_total",
  CALENDAR_PROVIDER_DURATION_MS: "calendar_provider_duration_ms_total",
  CALENDAR_PROVIDER_FAILURE: "calendar_provider_failure_count",
  CALENDAR_EVENTS_RETURNED: "calendar_events_returned_total",
  CALENDAR_REMINDER_SENT: "calendar_reminder_sent_count",
  CALENDAR_REMINDER_FAILURE: "calendar_reminder_failure_count",
  CALENDAR_AVAILABILITY_DURATION_MS: "calendar_availability_duration_ms_total",
  // Meetings (PRD #40 §303); provider duration is CALENDAR_PROVIDER_DURATION_MS{provider="meetings"}
  MEETING_CREATE_SUCCESS: "meeting_create_success_count",
  MEETING_CREATE_FAILURE: "meeting_create_failure_count",
  MEETING_RSVP: "meeting_rsvp_count",
  MEETING_MINUTES_FINALIZE: "meeting_minutes_finalize_count",
  MEETING_ACTION_TASK_CREATE: "meeting_action_task_create_count",
  MEETING_SERIES_GENERATED: "meeting_series_occurrences_generated_total",
  // Task commands: every outcome, exactly; the latency histogram keeps only the class (AUD-07 §5).
  TASK_MUTATION_OUTCOME: "task_mutation_outcome_total",
  // Approvals Center (PRD #41 §256)
  APPROVALS_QUEUE: "approvals_queue_count",
  APPROVALS_QUEUE_DURATION_MS: "approvals_queue_duration_ms_total",
  APPROVALS_PROVIDER_DURATION_MS: "approvals_provider_duration_ms_total",
  APPROVALS_PROVIDER_FAILURE: "approvals_provider_failure_count",
  APPROVAL_DECISION_SUCCESS: "approval_decision_success_count",
  APPROVAL_DECISION_FAILURE: "approval_decision_failure_count",
  APPROVAL_CONFLICT: "approval_conflict_count",
  APPROVAL_OVERDUE: "approval_overdue_count",
  // Timesheets (PRD #42 §268)
  TIMESHEET_LOAD_DURATION_MS: "timesheet_load_duration_ms_total",
  WORKLOG_CREATE_SUCCESS: "worklog_create_success_count",
  WORKLOG_CREATE_FAILURE: "worklog_create_failure_count",
  TIMESHEET_SUBMIT_SUCCESS: "timesheet_submit_success_count",
  TIMESHEET_APPROVAL_SUCCESS: "timesheet_approval_success_count",
  TIMESHEET_RETURN: "timesheet_return_count",
  TIMESHEET_MISSING: "timesheet_missing_count",
  // Daily logs (PRD #43 §275)
  DAILY_LOG_CREATE_SUCCESS: "daily_log_create_success_count",
  DAILY_LOG_SUBMIT_SUCCESS: "daily_log_submit_success_count",
  DAILY_LOG_REVIEW_SUCCESS: "daily_log_review_success_count",
  DAILY_LOG_LOCK_SUCCESS: "daily_log_lock_success_count",
  DAILY_LOG_MISSING: "daily_log_missing_count",
  DAILY_LOG_DETAIL_DURATION_MS: "daily_log_detail_duration_ms_total",
  DAILY_LOG_MEDIA_COUNT: "daily_log_media_count",
  // Project planning (PRD #44 §305)
  PLANNING_OVERVIEW_DURATION_MS: "planning_overview_duration_ms_total",
  PLANNING_TIMELINE_DURATION_MS: "planning_timeline_duration_ms_total",
  MILESTONE_CREATE_SUCCESS: "milestone_create_success_count",
  MILESTONE_UPDATE_SUCCESS: "milestone_update_success_count",
  MILESTONE_COMPLETE_SUCCESS: "milestone_complete_success_count",
  MILESTONE_OVERDUE: "milestone_overdue_count",
  DEPENDENCY_CYCLE_REJECTION: "dependency_cycle_rejection_count",
  // Announcements, favorites and recent work (PRD #45 §269)
  ANNOUNCEMENT_PUBLISH_SUCCESS: "announcement_publish_success_count",
  ANNOUNCEMENT_PUBLISH_FAILURE: "announcement_publish_failure_count",
  ANNOUNCEMENT_EXPIRE_SUCCESS: "announcement_expire_success_count",
  ANNOUNCEMENT_ACK_REMINDER_SENT: "announcement_ack_reminder_sent_count",
  // Contractors and engineering (PRD #46 §232).
  CONTRACTOR_CREATE_SUCCESS: "contractor_create_success",
  WORK_PACKAGE_CREATE_SUCCESS: "work_package_create_success",
  RFI_OPENED: "rfi_open_count",
  RFI_OVERDUE: "rfi_overdue_count",
  RFI_RESPONSE_DURATION: "rfi_response_duration",
  SUBMITTAL_SUBMITTED: "submittal_pending_review_count",
  SUBMITTAL_OVERDUE: "submittal_overdue_count",
  SUBMITTAL_REVISION_REQUIRED: "submittal_revision_required_count",
  ENGINEERING_REVIEW_DURATION: "engineering_review_duration",
  COMPLIANCE_EXPIRING: "contractor_compliance_expiring_count",
  UNIT_RESERVATIONS_EXPIRED: "unit_reservations_expired_count",
  UNIT_RESERVATIONS_WARNED: "unit_reservations_expiring_warned_count",
  UNIT_INSTALLMENTS_OVERDUE: "unit_installments_overdue_notified_count",
  UNIT_INSTALLMENTS_DUE_SOON: "unit_installments_due_soon_notified_count",
  COMPLIANCE_EXPIRED: "contractor_compliance_expired_count",
  RECENT_WORK_PRUNED: "recent_work_pruned_count",
  // Fast Re-entry §176; Quick Create §85; Activity Center §176.
  RECENT_TOUCH_ERROR: "recent_touch_error_total",
  FAVORITE_TOGGLE_ERROR: "favorite_toggle_error_total",
  RECORD_ROUTE_RESOLUTION_FAILURE: "record_route_resolution_failure_total",
  SEARCH_HOME_LOAD_MS: "search_home_load_ms",
  MY_WORK_LOAD_MS: "my_work_load_ms",
  QUICK_CREATE_LAUNCH_DENIED: "quick_create_launch_denied_total",
  ACTIVITY_CENTER_LOAD_MS: "activity_center_load_ms",
  // Authorization (PRD #47 §196)
  AUTHORIZATION_DENIED: "authorization_denied_total",
  CROSS_COMPANY_DENIED: "cross_company_denied_total",
  CROSS_PROJECT_DENIED: "cross_project_denied_total",
  MODULE_DISABLED_DENIED: "module_disabled_denied_total",
  PERMISSION_DENIED: "permission_denied_total",
  // Workspace navigation persistence (Workspace Switching Completion §106)
  WORKSPACE_SWITCH_SUCCESS: "workspace_switch_success_total",
  WORKSPACE_SWITCH_FAILURE: "workspace_switch_failure_total",
  WORKSPACE_SWITCH_FALLBACK_PARENT: "workspace_switch_fallback_parent_total",
  WORKSPACE_SWITCH_FALLBACK_DASHBOARD: "workspace_switch_fallback_dashboard_total",
  WORKSPACE_SWITCH_DURATION_MS: "workspace_switch_duration_ms",
  WORKSPACE_SWITCH_RECORD_VALIDATION_MS: "workspace_switch_record_validation_ms",
  WORKSPACE_SWITCH_STALE_RESPONSE: "workspace_switch_stale_response_total",
  // Unified record navigation (Record Navigation §141)
  BREADCRUMB_RESOLUTION_ERROR: "breadcrumb_resolution_error_total",
  HISTORY_NAVIGATION_INVALID_ENTRY: "history_navigation_invalid_entry_total",
  BREADCRUMB_CLICK: "breadcrumb_click_total",
  NAVIGATION_BACK_CLICK: "back_click_total",
  NAVIGATION_FORWARD_CLICK: "forward_click_total",
  // Transaction integrity (PRD #48 §180-§182)
  TRANSACTION_SUCCESS: "transaction_success_total",
  TRANSACTION_FAILURE: "transaction_failure_total",
  TRANSACTION_RETRY: "transaction_retry_total",
  CONFLICT: "conflict_total",
  IDEMPOTENCY_REPLAY: "idempotency_replay_total",
  // State integrity (PRD #49 §64, §236, §279)
  TRANSITION_APPLIED: "transition_applied_total",
  TRANSITION_CONFLICT: "transition_conflict_total",
  TRANSITION_REPLAY: "transition_replay_total",
  // Faster server loading (NAV-02 §16). Durations are totals with a matching
  // count; percentiles come from benchmark samples, not from these.
  REQUEST_SCOPE_REUSE: "request_scope_reuse_total",
  CONTEXT_RESOLVE_MS: "context_resolve_ms_total",
  CONTEXT_RESOLVE: "context_resolve_total",
  ORGANIZATION_LOAD_MS: "organization_load_ms_total",
  ORGANIZATION_LOAD: "organization_load_total",
  COMPANY_CONTEXTS_MS: "company_contexts_ms_total",
  COMPANY_CONTEXTS: "company_contexts_total",
  MAINTENANCE_DECISION_MS: "maintenance_decision_ms_total",
  MAINTENANCE_DECISION: "maintenance_decision_total",
  MAINTENANCE_PAGE_CACHE: "maintenance_page_cache_total",
  MAINTENANCE_READ_FAILURE: "maintenance_read_failure_total",
  MAINTENANCE_INVALIDATION_FAILURE: "maintenance_invalidation_failure_total",
  SHELL_CORE_READY_MS: "shell_core_ready_ms_total",
  SHELL_CORE_READY: "shell_core_ready_total",
  SHELL_SLOT: "shell_slot_total",
  // Navigation telemetry (NAV-03 §11). Outcome counters keep failures, timeouts,
  // abandoned and superseded stages in the denominators the histograms leave out.
  NAVIGATION_OUTCOME: "navigation_outcome_total",
  PANEL_OUTCOME: "panel_outcome_total",
  REQUEST_SUMMARY: "browser_request_total",
  // Projects page (Projects Workspace Grid §172). The query's duration is the
  // `project_discovery_query_ms` histogram.
  PROJECT_DISCOVERY_ERROR: "project_discovery_error_total",
  PROJECT_COVER_LOAD_ERROR: "project_cover_load_error_total",
  TELEMETRY_BATCH: "telemetry_batch_total",
  TELEMETRY_EVENT_DROPPED: "telemetry_event_dropped_total",
  SHELL_SLOT_MS: "shell_slot_ms_total",
  // Unsaved-work guard events from sampled browsers (AUD-03 §8): kind, departure
  // and module only — never a value, a record title or an attachment name.
  UNSAVED_GUARD: "unsaved_guard_total",
} as const;

/** Adds one timed run of a stage: its duration to `total`, one to `count`. */
export function recordDuration(total: MetricName, count: MetricName, startedAt: number, labels: Labels = {}): void {
  incrementCounter(total, labels, Math.max(0, Math.round(performance.now() - startedAt)));
  incrementCounter(count, labels);
}

export type MetricName = (typeof Metric)[keyof typeof Metric];

type Labels = Record<string, string>;

// Per process, not per module copy: a server bundle loads this module once for
// its pages and again for its route handlers, and the metrics endpoint must
// see what both counted (NAV-02 §16).
const processMetrics = globalThis as unknown as { __nestoCounters?: Map<string, { name: MetricName; labels: Labels; value: number }> };
const counters = (processMetrics.__nestoCounters ??= new Map<string, { name: MetricName; labels: Labels; value: number }>());

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

  return `${lines.join("\n")}\n${renderHistograms()}`;
}

/* -------------------------------------------------------------------------- */
/* Histograms (NAV-03 TELEMETRY-04)                                            */
/* -------------------------------------------------------------------------- */

/** Millisecond buckets for every duration histogram. */
export const DURATION_BUCKETS_MS = [25, 50, 100, 150, 250, 500, 750, 1000, 1500, 2500, 5000, 10000, 30000, 60000] as const;
/** Cumulative Layout Shift is dimensionless. */
export const CLS_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1] as const;

const ROUTE = ["dashboard", "projects", "clients", "tasks", "finance", "other"] as const;

/**
 * Every histogram family, with each label's allowed values spelled out: a
 * value outside them is dropped rather than creating a series, so browser
 * input can never widen what is exported. The product of the sets is the
 * family's series count, checked against the budget in the tests.
 */
export const HISTOGRAMS = {
  navigation_duration_ms: {
    help: "Navigation stage durations reported by sampled browsers, successful stages only.",
    buckets: DURATION_BUCKETS_MS,
    labels: { route: ROUTE, stage: ["feedback", "commit", "core", "primary", "settled"], kind: ["document", "spa", "history", "workspace"] },
  },
  panel_ready_ms: {
    help: "Top-bar panel readiness reported by sampled browsers.",
    buckets: DURATION_BUCKETS_MS,
    labels: { panel: ["search", "quick_create", "activity", "workspace"], cache: ["cold", "warm", "unknown"] },
  },
  web_vital: {
    help: "Document Web Vitals: milliseconds, except CLS (see web_vital_cls).",
    buckets: DURATION_BUCKETS_MS,
    labels: { metric: ["LCP", "INP", "FCP", "TTFB"], device: ["compact", "wide"] },
  },
  web_vital_cls: {
    help: "Document Cumulative Layout Shift.",
    buckets: CLS_BUCKETS,
    labels: { device: ["compact", "wide"] },
  },
  activity_read_ms: {
    help: "Server time for the bell's count and list reads.",
    buckets: DURATION_BUCKETS_MS,
    labels: { family: ["count", "list"], outcome: ["success", "failure"] },
  },
  unsaved_guard_ms: {
    help: "How long an unsaved-changes decision took, from the prompt to the person's choice or the save's answer (AUD-03 §8).",
    buckets: DURATION_BUCKETS_MS,
    labels: { event: ["stay", "discard", "save", "save_failed", "continued"], departure: ["navigate", "history", "dismiss", "workspace", "identity", "reload"] },
  },
  project_discovery_query_ms: {
    help: "Server time for one page of the Projects page's authorised project cards.",
    buckets: DURATION_BUCKETS_MS,
    labels: { scope: ["group", "company"], outcome: ["success", "failure"] },
  },
  finance_register_query_ms: {
    help: "Server time for one invoice or expense register read: a filtered page with its totals, or a CSV export.",
    buckets: DURATION_BUCKETS_MS,
    labels: { register: ["invoices", "expenses"], operation: ["list", "export"], scope: ["group", "company"], outcome: ["success", "failure", "refused"] },
  },
  task_mutation_ms: {
    help: "Server time for one task command, from its first check to its commit or refusal. Conflicts are an outcome, never content.",
    buckets: DURATION_BUCKETS_MS,
    labels: {
      command: ["edit", "start", "block", "complete", "reopen", "archive", "restore"],
      outcome: ["committed", "unchanged", "rejected", "error"],
    },
    /*
     * The latency of a refusal is one check's, whichever refusal it is: the
     * histogram keeps the outcome's class, and the exact outcome is counted in
     * `task_mutation_outcome_total{command,outcome}` (AUD-07 §5, PS-21). Eight
     * outcomes × seven commands × seventeen series was 952 of the 4,000.
     */
    fold: {
      outcome: {
        version_conflict: "rejected",
        state_conflict: "rejected",
        version_required: "rejected",
        refused: "rejected",
        retryable: "error",
        failure: "error",
      },
    },
    detailCounter: "task_mutation_outcome_total",
  },
} as const satisfies Record<
  string,
  {
    help: string;
    buckets: readonly number[];
    labels: Record<string, readonly string[]>;
    /** Input values folded into an exported one before the series is chosen: detail without cardinality. */
    fold?: Record<string, Record<string, string>>;
    /** A counter that keeps the unfolded labels, so the folded detail is still counted exactly. */
    detailCounter?: MetricName;
  }
>;

export type HistogramName = keyof typeof HISTOGRAMS;
type HistogramDefinition<N extends HistogramName> = (typeof HISTOGRAMS)[N];
/** The input values a label accepts: its exported values, and any value folded into one of them. */
type FoldedInput<N extends HistogramName, K> = HistogramDefinition<N> extends { fold: infer F } ? (K extends keyof F ? keyof F[K] & string : never) : never;
export type HistogramLabels<N extends HistogramName> = {
  [K in keyof HistogramDefinition<N>["labels"]]: (HistogramDefinition<N>["labels"][K] extends readonly (infer V)[] ? V : never) | FoldedInput<N, K>;
};

/** The exported series a family can ever have: label combinations × (buckets + +Inf + sum + count). */
export function histogramSeriesBudget(name: HistogramName): number {
  const definition = HISTOGRAMS[name];
  const combinations = Object.values(definition.labels).reduce((product, values) => product * (values as readonly string[]).length, 1);
  return combinations * (definition.buckets.length + 3);
}

type HistogramSeries = { name: HistogramName; labels: Labels; buckets: number[]; sum: number; count: number };
const processHistograms = globalThis as unknown as { __nestoHistograms?: Map<string, HistogramSeries> };
const histograms = (processHistograms.__nestoHistograms ??= new Map<string, HistogramSeries>());

/** Records one observation; false when a label or the value is not allowed (nothing is recorded). */
export function observeHistogram<N extends HistogramName>(name: N, labels: HistogramLabels<N>, value: number): boolean {
  const definition = HISTOGRAMS[name] as (typeof HISTOGRAMS)[HistogramName] & { fold?: Record<string, Record<string, string>>; detailCounter?: MetricName };
  if (!Number.isFinite(value) || value < 0) return false;
  const allowed = definition.labels as Record<string, readonly string[]>;
  const input = labels as Record<string, string>;
  if (Object.keys(input).length !== Object.keys(allowed).length) return false;
  // Folding happens before validation, and only through the declared map: an undeclared value is still dropped.
  const given: Record<string, string> = {};
  for (const [key, values] of Object.entries(allowed)) {
    const raw = input[key];
    const folded = raw !== undefined && Object.hasOwn(definition.fold?.[key] ?? {}, raw) ? definition.fold![key]![raw]! : raw;
    if (!values.includes(folded)) return false;
    given[key] = folded;
  }
  if (definition.detailCounter) incrementCounter(definition.detailCounter, { ...input });
  const key = seriesKey(name, given);
  let series = histograms.get(key);
  if (!series) {
    series = { name, labels: { ...given }, buckets: definition.buckets.map(() => 0), sum: 0, count: 0 };
    histograms.set(key, series);
  }
  definition.buckets.forEach((bound, index) => {
    if (value <= bound) series!.buckets[index] += 1;
  });
  series.sum += value;
  series.count += 1;
  return true;
}

export function histogramSeries(): HistogramSeries[] {
  return [...histograms.values()].map((series) => ({ ...series, labels: { ...series.labels }, buckets: [...series.buckets] }));
}

/** Test seam. */
export function resetHistograms(): void {
  histograms.clear();
}

/** Prometheus histogram text: cumulative `le` buckets, `+Inf`, `_sum` and `_count`. */
export function renderHistograms(): string {
  const lines: string[] = [];
  const byName = new Map<HistogramName, HistogramSeries[]>();
  for (const series of histograms.values()) byName.set(series.name, [...(byName.get(series.name) ?? []), series]);
  for (const [name, all] of byName) {
    const definition = HISTOGRAMS[name];
    lines.push(`# HELP ${name} ${definition.help}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const series of all) {
      definition.buckets.forEach((bound, index) => {
        lines.push(`${name}_bucket${formatLabels({ ...series.labels, le: String(bound) })} ${series.buckets[index]}`);
      });
      lines.push(`${name}_bucket${formatLabels({ ...series.labels, le: "+Inf" })} ${series.count}`);
      lines.push(`${name}_sum${formatLabels(series.labels)} ${series.sum}`);
      lines.push(`${name}_count${formatLabels(series.labels)} ${series.count}`);
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
