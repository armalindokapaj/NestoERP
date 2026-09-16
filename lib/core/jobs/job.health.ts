import { databaseNow } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { JOBS, jobUnavailableReason, type Criticality, type JobDefinition, type WorkerGroup } from "./job.registry";
import { liveWorkers, type LiveWorker } from "./worker.process";

/**
 * Where every job, and the worker as a whole, stands (PRD #38 §97, §104,
 * PRD #51 §110-§118).
 *
 * Read from the heartbeat rows and the process heartbeats by the database's
 * clock, so every web instance and every worker gives the same answer.
 */

export type JobState =
  /** Last run succeeded within its expected interval. */
  | "ok"
  /** The last success is older than the job's staleAfter. */
  | "stale"
  /** The last run failed; retries are still in hand. */
  | "failing"
  /** Failed `maxAttempts` runs in a row (§35). */
  | "failed"
  | "never_run"
  /** Switched off, or its capability is missing — not expected to run. */
  | "disabled"
  /** Manual jobs have no schedule to be behind on. */
  | "manual";

export type JobHealth = {
  job: string;
  group: WorkerGroup;
  criticality: Criticality;
  state: JobState;
  /** A live lease: the job is running right now. */
  running: boolean;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAgeSeconds: number | null;
  nextRunAt: string | null;
  started: number;
  successes: number;
  failures: number;
  retries: number;
  timeouts: number;
  lastDurationMs: number | null;
};

export async function jobHealth(options: { now?: Date; env?: NodeJS.ProcessEnv; capabilities?: { scanner: boolean } } = {}): Promise<JobHealth[]> {
  const now = options.now ?? (await databaseNow());
  const rows = await prisma.workerHeartbeat.findMany({
    select: {
      job: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      leaseExpiresAt: true,
      nextRunAt: true,
      consecutiveFailures: true,
      lastErrorCode: true,
      started: true,
      successes: true,
      failures: true,
      retries: true,
      timeouts: true,
      lastDurationMs: true,
    },
  });
  const byJob = new Map(rows.map((row) => [row.job, row]));

  return JOBS.map((job) => {
    const row = byJob.get(job.key);
    const age = row?.lastSuccessAt ? Math.max(0, Math.round((now.getTime() - row.lastSuccessAt.getTime()) / 1000)) : null;
    const failingNow = Boolean(row?.lastFailureAt && (!row.lastSuccessAt || row.lastFailureAt > row.lastSuccessAt));
    return {
      job: job.key,
      group: job.group,
      criticality: job.criticality,
      state: stateOf(job, row, age, failingNow, options),
      running: Boolean(row?.leaseExpiresAt && row.leaseExpiresAt > now),
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      lastErrorCode: failingNow ? (row?.lastErrorCode ?? null) : null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: row?.lastFailureAt?.toISOString() ?? null,
      lastSuccessAgeSeconds: age,
      nextRunAt: row?.nextRunAt?.toISOString() ?? null,
      started: row?.started ?? 0,
      successes: row?.successes ?? 0,
      failures: row?.failures ?? 0,
      retries: row?.retries ?? 0,
      timeouts: row?.timeouts ?? 0,
      lastDurationMs: row?.lastDurationMs ?? null,
    };
  });
}

function stateOf(
  job: JobDefinition,
  row: { lastSuccessAt: Date | null; consecutiveFailures: number } | undefined,
  age: number | null,
  failingNow: boolean,
  options: { env?: NodeJS.ProcessEnv; capabilities?: { scanner: boolean } },
): JobState {
  if (jobUnavailableReason(job, { env: options.env ?? process.env, capabilities: options.capabilities })) return "disabled";
  if (job.trigger === "MANUAL") return failingNow ? "failing" : "manual";
  if (failingNow) return (row?.consecutiveFailures ?? 0) >= job.retry.maxAttempts ? "failed" : "failing";
  if (!row?.lastSuccessAt) return "never_run";
  return age !== null && age > job.staleAfterSeconds ? "stale" : "ok";
}

export type WorkerHealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

export type WorkerHealth = {
  status: WorkerHealthStatus;
  /** Groups whose jobs no live worker process is running. */
  groupsWithoutWorker: WorkerGroup[];
  workers: LiveWorker[];
  jobs: JobHealth[];
  reasons: string[];
};

const EXPECTED: ReadonlySet<JobState> = new Set(["ok", "disabled", "manual"]);

/**
 * The worker tier's health (§113, §111, §118).
 *
 * UNHEALTHY — a group with a CRITICAL job has no live worker, or a CRITICAL job
 *   is failed, stale or has never run.
 * DEGRADED — any other job is not ok, or a group without critical jobs has no
 *   live worker.
 */
export async function workerHealth(options: { env?: NodeJS.ProcessEnv; capabilities?: { scanner: boolean } } = {}): Promise<WorkerHealth> {
  const now = await databaseNow();
  const [jobs, workers] = await Promise.all([jobHealth({ ...options, now }), liveWorkers()]);
  const reasons: string[] = [];
  let status: WorkerHealthStatus = "HEALTHY";
  const worsen = (to: WorkerHealthStatus, reason: string) => {
    reasons.push(reason);
    if (to === "UNHEALTHY" || status === "HEALTHY") status = to;
  };

  const covered = new Set(workers.flatMap((worker) => worker.groups));
  const scheduledGroups = [...new Set(jobs.filter((job) => job.state !== "disabled" && job.state !== "manual").map((job) => job.group))];
  const groupsWithoutWorker = scheduledGroups.filter((group) => !covered.has(group));
  for (const group of groupsWithoutWorker) {
    const critical = jobs.some((job) => job.group === group && job.criticality === "CRITICAL" && job.state !== "disabled");
    worsen(critical ? "UNHEALTHY" : "DEGRADED", `no live worker runs the ${group} group`);
  }

  for (const job of jobs) {
    if (EXPECTED.has(job.state)) continue;
    // A job that is merely behind while its worker is in the middle of it is not news.
    if (job.state === "never_run" && job.running) continue;
    const severe = job.criticality === "CRITICAL" && job.state !== "failing";
    worsen(severe ? "UNHEALTHY" : "DEGRADED", `${job.job} is ${job.state}`);
  }

  return { status, groupsWithoutWorker, workers, jobs, reasons };
}
