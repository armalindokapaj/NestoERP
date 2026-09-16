/**
 * The worker registry (PRD #38 §93-§97, PRD #51 §4, §106-§110, §231).
 *
 * Every background job the deployment runs, and everything an operator or a
 * reviewer needs to know about it without reading its code: who owns it, what
 * starts it, which company it acts for, what makes running it twice harmless,
 * how it retries, how long it may take, and how much it matters when it stops.
 *
 * The runner, the worker's startup check, health, metrics, the CI gate and
 * `docs/worker-matrix.md` all read this one list. A job that is not here does
 * not run; a job that is here and breaks a rule below fails startup and CI.
 *
 * Kept free of implementation imports so a health probe reading it does not
 * load every job's dependencies — handlers are in `job.handlers.ts`.
 */

export const WORKER_GROUPS = ["notifications", "documents", "scheduled"] as const;
export type WorkerGroup = (typeof WORKER_GROUPS)[number];

/** What starts a job (PRD #51 §5-§9). */
export type JobTrigger =
  /** Due on a cadence. */
  | "SCHEDULED"
  /** Drains a durable queue of work items, polled continuously. */
  | "OUTBOX"
  /** Recomputes a condition from its source of truth. */
  | "RECONCILIATION"
  /** Never scheduled: an operator runs it (`pnpm worker --run=`). */
  | "MANUAL";

/**
 * Whose data a run touches (PRD #51 §10, §11, §144, §145).
 *
 * COMPANY — company by company through `forEachCompany`, each with its own
 *   SystemContext; one company's failure never costs another its run.
 * RECORD — a queue whose every item carries its own company, and every write
 *   is keyed to that item (the outbox, the scan queue, upload sessions).
 * PLATFORM — technical rows that belong to no company (throttle buckets,
 *   retention of operational debris).
 */
export type CompanyScope = "COMPANY" | "RECORD" | "PLATFORM";

/** How much the product depends on the job (PRD #51 §110-§112, §246-§248). */
export type Criticality = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export type RetryPolicy = {
  /**
   * Consecutive failed runs before the job is FAILED. A scheduled job is not
   * dropped at that point — the next scheduled run is its next chance — but it
   * stops retrying early, health reports it failed, and the alert fires.
   */
  maxAttempts: number;
  /** Delay before the first retry; doubled per consecutive failure, with jitter (§33). */
  initialDelaySeconds: number;
  maxDelaySeconds: number;
};

export type JobContext = {
  now: Date;
  lastSuccessAt: Date | null;
  env: NodeJS.ProcessEnv;
  /** Aborted on timeout, on a lost lease and on shutdown; long jobs check it between units of work (§55, §57). */
  signal: AbortSignal;
  /** Report what would change and change nothing (§165, §166). Only jobs declaring `dryRun` receive true. */
  dryRun: boolean;
  /** An operator's `--company`: only these companies, for COMPANY-scoped jobs (§164). */
  companyIds: readonly string[] | null;
  correlationId: string;
  workerId: string;
};

export type JobResult = { processed: number; detail?: Record<string, unknown> };
export type JobHandler = (context: JobContext) => Promise<JobResult>;

export type JobDefinition = {
  key: string;
  /** The owning domain, as a directory: `lib/modules/<owner>` or `lib/core/<name>` for `core/<name>` (§4, PRD #48). */
  owner: string;
  purpose: string;
  group: WorkerGroup;
  trigger: JobTrigger;
  /** How long after a run finishes before the job is due again. MANUAL jobs: 0. */
  intervalSeconds: number;
  /**
   * The claim. A running job extends it every third of its length, so it only
   * runs out when the worker holding it has died — and then another takes over
   * within this long (§26-§28, §158).
   */
  leaseSeconds: number;
  /** The run is aborted past this, and recorded as a TIMEOUT failure (§55-§57). */
  timeoutSeconds: number;
  /** How stale the last success may be before health reports the job stale. */
  staleAfterSeconds: number;
  retry: RetryPolicy;
  /** V0.1 runs every job on one worker at a time, through its lease (§142). */
  concurrency: "SINGLETON";
  companyScope: CompanyScope;
  /** Whether suspended companies' work is skipped, and why not when it is not (§145). */
  suspendedCompanies: "SKIPPED" | "INCLUDED" | "NOT_APPLICABLE";
  /** The logical work item and what makes it unique (§15, §16). */
  idempotencyKey: string;
  /** What a run does about runs that were missed (§51, §52). */
  catchUp: string;
  criticality: Criticality;
  /** Operational switch (§109). `WORKER_DISABLED_JOBS` turns a job off per deployment without a code change. */
  enabled: boolean;
  /**
   * A capability the job depends on (§214, §215). When it is missing the job is
   * not run at all, and startup says so, rather than running to do nothing.
   */
  requires?: "scanner";
  /** Whether `--dry-run` is meaningful for this job (§165). */
  dryRun: boolean;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A job that must keep up with people's actions: retried within minutes. */
const FAST_RETRY: RetryPolicy = { maxAttempts: 5, initialDelaySeconds: 15, maxDelaySeconds: 5 * MINUTE };
/** Periodic checks: retried within the hour, well before the next run. */
const PERIODIC_RETRY: RetryPolicy = { maxAttempts: 4, initialDelaySeconds: MINUTE, maxDelaySeconds: 30 * MINUTE };
/** Daily housekeeping: a few tries across the day. */
const DAILY_RETRY: RetryPolicy = { maxAttempts: 3, initialDelaySeconds: 5 * MINUTE, maxDelaySeconds: 2 * HOUR };

export const JOBS: JobDefinition[] = [
  /* Notifications ---------------------------------------------------------- */
  {
    key: "notifications.dispatch",
    owner: "core/notifications",
    purpose: "Drains the notification outbox: resolves each event's entitled recipients, writes in-app notifications, sends eligible email.",
    group: "notifications",
    trigger: "OUTBOX",
    intervalSeconds: 10,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 5 * MINUTE,
    staleAfterSeconds: 10 * MINUTE,
    retry: FAST_RETRY,
    concurrency: "SINGLETON",
    companyScope: "RECORD",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "outbox event id; each notification unique on company + recipient + event dedupe key",
    catchUp: "Events wait in the outbox and drain oldest first.",
    criticality: "CRITICAL",
    enabled: true,
    dryRun: false,
  },
  {
    key: "calendar.reminders",
    owner: "calendar",
    purpose: "Fires due calendar event and meeting reminders, once per occurrence, into the outbox.",
    group: "notifications",
    trigger: "SCHEDULED",
    intervalSeconds: MINUTE,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 5 * MINUTE,
    staleAfterSeconds: 10 * MINUTE,
    retry: FAST_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "reminder id + occurrence start (unique delivery row)",
    catchUp: "Reminders that fell due in the last six hours still fire, unless what they are about started more than 15 minutes ago; older ones are dropped, not sent late.",
    criticality: "HIGH",
    enabled: true,
    dryRun: false,
  },
  {
    key: "notifications.due",
    owner: "core/notifications",
    purpose: "Enqueues overdue-task and contract-obligation-due events for dates crossed since the last success.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 15 * MINUTE,
    staleAfterSeconds: 3 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "TASK_OVERDUE | CONTRACT_OBLIGATION_DUE + companyId + record id + due date",
    catchUp: "Covers every date crossed since the last success.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },
  {
    key: "attention.reconcile",
    owner: "core/notifications",
    purpose: "Makes attention items agree with what is true: raises, refreshes and resolves them.",
    group: "scheduled",
    trigger: "RECONCILIATION",
    intervalSeconds: 5 * MINUTE,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 15 * MINUTE,
    staleAfterSeconds: 30 * MINUTE,
    retry: FAST_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "condition + record + episode + recipient (unique active item)",
    catchUp: "Nothing to catch up: each run recomputes the desired state.",
    criticality: "HIGH",
    enabled: true,
    dryRun: true,
  },
  {
    key: "approvals.overdue",
    owner: "approvals",
    purpose: "Reminds approvers of approvals past due, once a day per approval step.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 15 * MINUTE,
    staleAfterSeconds: 3 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "APPROVAL_OVERDUE + companyId + approval step + company-local day",
    catchUp: "A missed day is not replayed; the next run reminds again while the approval is still overdue.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },

  /* Business reminders ----------------------------------------------------- */
  {
    key: "announcements.schedule",
    owner: "announcements",
    purpose: "Publishes scheduled announcements when due and expires published ones, each once.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: MINUTE,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 5 * MINUTE,
    staleAfterSeconds: 10 * MINUTE,
    retry: FAST_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "announcement id + transition, guarded on the status and version read",
    catchUp: "Publishes past-due schedules that have not expired; a schedule already past its expiry returns to draft, audited.",
    criticality: "HIGH",
    enabled: true,
    dryRun: false,
  },
  {
    key: "announcements.reminders",
    owner: "announcements",
    purpose: "Reminds members who have not acknowledged an announcement, once per reminder round.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 15 * MINUTE,
    staleAfterSeconds: 3 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "ANNOUNCEMENT_REMINDER + companyId + announcement id + round",
    catchUp: "Skipped rounds are not replayed; one reminder goes out for the current round.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },
  {
    key: "timesheets.reminders",
    owner: "timesheets",
    purpose: "Reminds members whose week is not submitted as the company's deadline approaches.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 15 * MINUTE,
    staleAfterSeconds: 3 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "TIMESHEET_REMINDER + companyId + member + period start",
    catchUp: "Only inside the deadline window; past it, attention covers the missing week.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },
  {
    key: "dailylogs.missing",
    owner: "daily-logs",
    purpose: "Reminds a project's people when its last working day has no daily log.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 15 * MINUTE,
    staleAfterSeconds: 3 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "DAILY_LOG_MISSING + companyId + project + work date",
    catchUp: "Only the last working day is checked; earlier gaps are attention, not reminders.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },
  {
    key: "planning.milestones",
    owner: "project-planning",
    purpose: "Due-soon and overdue milestone reminders, once per milestone per target date.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 15 * MINUTE,
    staleAfterSeconds: 3 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "MILESTONE_DUE_SOON | MILESTONE_OVERDUE + companyId + milestone + target date",
    catchUp: "Recomputed each run; a missed due-soon window still gets its overdue reminder.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },
  {
    key: "engineering.reminders",
    owner: "engineering",
    purpose: "RFI and submittal review due-soon and overdue reminders, once per due date.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 15 * MINUTE,
    staleAfterSeconds: 3 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "RFI_OVERDUE | RFI_DUE_SOON | SUBMITTAL_* + companyId + record + due date",
    catchUp: "Recomputed each run; a missed due-soon window still gets its overdue reminder.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },
  {
    key: "contractors.compliance",
    owner: "contractors",
    purpose: "Moves compliance items to EXPIRING and EXPIRED and tells the people responsible, once per expiry date.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: DAY,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 30 * MINUTE,
    staleAfterSeconds: 49 * HOUR,
    retry: DAILY_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "CONTRACTOR_COMPLIANCE_EXPIRING | _EXPIRED + companyId + item + expiry date",
    catchUp: "An item already past its expiry goes straight to EXPIRED.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },
  {
    key: "meetings.series",
    owner: "meetings",
    purpose: "Tops recurring meeting series up to their rolling horizon.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: 6 * HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 30 * MINUTE,
    staleAfterSeconds: 25 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "SKIPPED",
    idempotencyKey: "series + occurrence index (unique meeting row)",
    catchUp: "Fills every missing occurrence up to the horizon, never one already past.",
    criticality: "NORMAL",
    enabled: true,
    dryRun: false,
  },

  /* Documents -------------------------------------------------------------- */
  {
    key: "documents.scan",
    owner: "documents",
    purpose: "Scans files waiting on the malware scanner, recovers scans a crashed worker abandoned, promotes clean versions (never over a newer one), and fails a file the scanner cannot give a verdict on after its attempts.",
    group: "documents",
    trigger: "OUTBOX",
    intervalSeconds: 15,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 10 * MINUTE,
    staleAfterSeconds: 15 * MINUTE,
    retry: FAST_RETRY,
    concurrency: "SINGLETON",
    companyScope: "RECORD",
    suspendedCompanies: "INCLUDED",
    idempotencyKey: "document or document version id, claimed on the scan columns as read (status, scanStartedAt, scanAttempts)",
    catchUp: "The scan queue is the status column: waiting files wait.",
    criticality: "CRITICAL",
    enabled: true,
    requires: "scanner",
    dryRun: false,
  },
  {
    key: "storage.cleanup",
    owner: "documents",
    purpose: "Expires abandoned upload sessions and removes their never-completed objects after the grace period.",
    group: "documents",
    trigger: "SCHEDULED",
    intervalSeconds: 15 * MINUTE,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 20 * MINUTE,
    staleAfterSeconds: 2 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "RECORD",
    suspendedCompanies: "INCLUDED",
    idempotencyKey: "upload session storage key, re-checked against finalized documents before deletion",
    catchUp: "Time-based: anything past its grace period is found on the next run.",
    criticality: "HIGH",
    enabled: true,
    dryRun: true,
  },
  {
    key: "storage.orphans",
    owner: "documents",
    purpose: "Reports documents and document versions whose object is missing from storage. Read-only: an orphan is a restore incident.",
    group: "documents",
    trigger: "RECONCILIATION",
    intervalSeconds: DAY,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 45 * MINUTE,
    staleAfterSeconds: 49 * HOUR,
    retry: DAILY_RETRY,
    concurrency: "SINGLETON",
    companyScope: "RECORD",
    suspendedCompanies: "INCLUDED",
    idempotencyKey: "read-only; nothing to deduplicate",
    catchUp: "Nothing to catch up: each run checks the current state.",
    criticality: "LOW",
    enabled: true,
    dryRun: true,
  },
  {
    key: "storage.usage",
    owner: "documents",
    purpose: "Rebuilds each company's storage usage projection from its documents.",
    group: "documents",
    trigger: "MANUAL",
    intervalSeconds: 0,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 30 * MINUTE,
    staleAfterSeconds: 0,
    retry: DAILY_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "INCLUDED",
    idempotencyKey: "company; a recompute from source, so a second run writes the same numbers",
    catchUp: "Manual only.",
    criticality: "LOW",
    enabled: true,
    dryRun: false,
  },

  /* Housekeeping ----------------------------------------------------------- */
  {
    key: "recentwork.prune",
    owner: "productivity",
    purpose: "Drops recent-work entries past the company's retention and past the hundred newest per member.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: DAY,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 30 * MINUTE,
    staleAfterSeconds: 49 * HOUR,
    retry: DAILY_RETRY,
    concurrency: "SINGLETON",
    companyScope: "COMPANY",
    suspendedCompanies: "INCLUDED",
    idempotencyKey: "member's recent list; deleting what is already gone deletes nothing",
    catchUp: "Time-based: the next run removes everything past the cutoff.",
    criticality: "LOW",
    enabled: true,
    dryRun: true,
  },
  {
    key: "retention.run",
    owner: "core/retention",
    purpose: "Applies retention policies to operational debris, in batches. Dry run unless WORKER_RETENTION_APPLY=true.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: DAY,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: HOUR,
    staleAfterSeconds: 49 * HOUR,
    retry: DAILY_RETRY,
    concurrency: "SINGLETON",
    companyScope: "PLATFORM",
    suspendedCompanies: "NOT_APPLICABLE",
    idempotencyKey: "policy + cutoff; rows already deleted are not candidates",
    catchUp: "Time-based: the next run removes everything past the cutoff.",
    criticality: "LOW",
    enabled: true,
    dryRun: true,
  },
  {
    key: "security.throttle-purge",
    owner: "core/security",
    purpose: "Removes rate-limit buckets whose window has closed, by the database's clock.",
    group: "scheduled",
    trigger: "SCHEDULED",
    intervalSeconds: HOUR,
    leaseSeconds: 2 * MINUTE,
    timeoutSeconds: 5 * MINUTE,
    staleAfterSeconds: 3 * HOUR,
    retry: PERIODIC_RETRY,
    concurrency: "SINGLETON",
    companyScope: "PLATFORM",
    suspendedCompanies: "NOT_APPLICABLE",
    idempotencyKey: "bucket key; a closed window is deleted once",
    catchUp: "Time-based.",
    criticality: "LOW",
    enabled: true,
    dryRun: false,
  },
];

export function findJob(key: string): JobDefinition | undefined {
  return JOBS.find((job) => job.key === key);
}

/** Jobs a deployment has switched off with `WORKER_DISABLED_JOBS` (§109). */
export function disabledByEnvironment(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.WORKER_DISABLED_JOBS ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

/**
 * Why a job will not run here, or null when it will (§109, §214).
 * `capabilities` is passed in so this file never loads what it describes.
 */
export function jobUnavailableReason(
  job: JobDefinition,
  options: { env?: NodeJS.ProcessEnv; capabilities?: { scanner: boolean } } = {},
): string | null {
  if (!job.enabled) return "disabled in the registry";
  if (disabledByEnvironment(options.env).has(job.key)) return "disabled by WORKER_DISABLED_JOBS";
  if (job.requires === "scanner" && options.capabilities && !options.capabilities.scanner) return "no malware scanner configured";
  return null;
}

const KEY_FORMAT = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

/**
 * Everything startup and CI refuse (§106-§108, §198).
 *
 * Returns problems rather than throwing, so the CI test can list them all and
 * the worker can print them all before it exits.
 */
export function validateRegistry(jobs: readonly JobDefinition[], handlers: Readonly<Record<string, unknown>>, env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const job of jobs) {
    const at = `job ${job.key || "(no key)"}`;
    if (!KEY_FORMAT.test(job.key)) problems.push(`${at}: key must be <area>.<name> in lower case`);
    if (seen.has(job.key)) problems.push(`${at}: duplicate job key`);
    seen.add(job.key);

    if (typeof handlers[job.key] !== "function") problems.push(`${at}: no handler`);
    if (!job.owner) problems.push(`${at}: no owner`);
    if (!job.purpose.trim()) problems.push(`${at}: no purpose`);
    if (!job.idempotencyKey.trim()) problems.push(`${at}: no idempotency key`);
    if (!job.catchUp.trim()) problems.push(`${at}: no catch-up behaviour`);
    if (!WORKER_GROUPS.includes(job.group)) problems.push(`${at}: unknown group ${job.group}`);

    const integer = (value: number) => Number.isInteger(value) && value >= 0;
    if (job.trigger === "MANUAL") {
      if (job.intervalSeconds !== 0) problems.push(`${at}: a MANUAL job has no interval`);
    } else {
      if (!integer(job.intervalSeconds) || job.intervalSeconds < 10) problems.push(`${at}: interval must be at least 10 seconds`);
      if (!integer(job.staleAfterSeconds) || job.staleAfterSeconds <= job.intervalSeconds) problems.push(`${at}: staleAfter must exceed the interval`);
    }
    if (!integer(job.leaseSeconds) || job.leaseSeconds < 30) problems.push(`${at}: lease must be at least 30 seconds, so extending it every third is not a busy loop`);
    if (!integer(job.timeoutSeconds) || job.timeoutSeconds < 1) problems.push(`${at}: no timeout`);
    if (job.timeoutSeconds > 2 * 60 * 60) problems.push(`${at}: a timeout over two hours is not a timeout`);

    const retry = job.retry as RetryPolicy | undefined;
    if (!retry) {
      problems.push(`${at}: no retry policy`);
    } else {
      if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > 20) problems.push(`${at}: maxAttempts must be 1-20`);
      if (!integer(retry.initialDelaySeconds) || retry.initialDelaySeconds < 1) problems.push(`${at}: retry needs an initial delay`);
      if (!integer(retry.maxDelaySeconds) || retry.maxDelaySeconds < retry.initialDelaySeconds) problems.push(`${at}: retry maxDelay must be at least the initial delay`);
    }

    if (job.companyScope === "PLATFORM" && job.suspendedCompanies !== "NOT_APPLICABLE") problems.push(`${at}: a PLATFORM job has no companies to skip`);
    if (job.companyScope !== "PLATFORM" && job.suspendedCompanies === "NOT_APPLICABLE") problems.push(`${at}: say whether suspended companies are skipped`);
  }

  for (const key of Object.keys(handlers)) {
    if (!seen.has(key)) problems.push(`handler ${key}: no job registered for it`);
  }

  for (const key of disabledByEnvironment(env)) {
    if (!seen.has(key)) problems.push(`WORKER_DISABLED_JOBS names an unknown job: ${key}`);
  }

  return problems;
}
