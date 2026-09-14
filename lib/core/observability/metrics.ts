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
  COMPLIANCE_EXPIRED: "contractor_compliance_expired_count",
  RECENT_WORK_PRUNED: "recent_work_pruned_count",
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
