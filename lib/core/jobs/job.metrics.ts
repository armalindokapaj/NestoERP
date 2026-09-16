import { Prisma } from "@prisma/client";

import { DB_NOW } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import type { GaugeSample } from "@/lib/core/observability/metrics";
import { workerHealth } from "./job.health";
import { WORKER_GROUPS } from "./job.registry";
import { liveWorkers } from "./worker.process";

/**
 * Worker metrics, read from the database at scrape time (PRD #51 §119, §120, §124).
 *
 * The worker serves no HTTP, so counters kept in its memory are never scraped.
 * Everything here is what the heartbeat rows, the process heartbeats and the
 * failure history already hold, exposed by the web tier's metrics endpoint —
 * the same numbers whichever instance is asked.
 *
 * Labels are `job`, `criticality` and `group` only: never a company, never a
 * record (§120).
 */

export async function failuresSince(seconds: number, options: { errorCode?: string } = {}): Promise<number> {
  const code = options.errorCode ? Prisma.sql`AND "errorCode" = ${options.errorCode}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS "count" FROM "job_failures"
    WHERE "failedAt" >= ${DB_NOW} - (${seconds} * interval '1 second') ${code}`;
  return rows[0]?.count ?? 0;
}

export async function workerGauges(options: { capabilities?: { scanner: boolean } } = {}): Promise<GaugeSample[]> {
  const [health, workers, failuresByJob, leaseExpiries] = await Promise.all([
    workerHealth(options),
    liveWorkers(),
    prisma.$queryRaw<Array<{ jobKey: string; count: number }>>`
      SELECT "jobKey", COUNT(*)::int AS "count" FROM "job_failures"
      WHERE "failedAt" >= ${DB_NOW} - interval '1 hour'
      GROUP BY "jobKey"`,
    prisma.$queryRaw<Array<{ jobKey: string; count: number }>>`
      SELECT "jobKey", COUNT(*)::int AS "count" FROM "job_failures"
      WHERE "failedAt" >= ${DB_NOW} - interval '1 hour' AND "errorCode" = 'LEASE_EXPIRED'
      GROUP BY "jobKey"`,
  ]);
  const failures = new Map(failuresByJob.map((row) => [row.jobKey, row.count]));
  const expiries = new Map(leaseExpiries.map((row) => [row.jobKey, row.count]));

  const gauges: GaugeSample[] = [
    { name: "worker_health_status", value: health.status === "HEALTHY" ? 0 : health.status === "DEGRADED" ? 1 : 2, help: "Worker tier health: 0 healthy, 1 degraded, 2 unhealthy" },
  ];

  for (const group of WORKER_GROUPS) {
    const inGroup = workers.filter((worker) => worker.groups.includes(group));
    gauges.push({ name: "worker_processes_live", labels: { group }, value: inGroup.length, help: "Worker processes that have beaten within the stale threshold" });
    gauges.push({
      name: "worker_heartbeat_age_seconds",
      labels: { group },
      value: inGroup.length ? Math.min(...inGroup.map((worker) => worker.heartbeatAgeSeconds)) : -1,
      help: "Seconds since the freshest worker process for the group beat (-1: none alive)",
    });
  }

  for (const job of health.jobs) {
    // `criticality` has four values and is what an alert rule pages on (§124).
    const labels = { job: job.job, criticality: job.criticality };
    gauges.push(
      { name: "worker_last_success_age_seconds", labels, value: job.lastSuccessAgeSeconds ?? -1, help: "Seconds since the job last succeeded (-1: never)" },
      { name: "worker_job_healthy", labels, value: job.state === "ok" || job.state === "disabled" || job.state === "manual" ? 1 : 0, help: "1 when the job's last run succeeded within its expected interval" },
      { name: "worker_job_failed", labels, value: job.state === "failed" ? 1 : 0, help: "1 when the job has failed its maximum attempts in a row" },
      { name: "worker_job_active", labels, value: job.running ? 1 : 0, help: "1 while a worker holds the job's lease" },
      { name: "worker_job_consecutive_failures", labels, value: job.consecutiveFailures, help: "Failed runs since the last success" },
      { name: "worker_job_started_total", labels, value: job.started, help: "Runs claimed" },
      { name: "worker_job_completed_total", labels, value: job.successes, help: "Runs that succeeded" },
      { name: "worker_job_failed_total", labels, value: job.failures, help: "Runs that failed" },
      { name: "worker_job_retried_total", labels, value: job.retries, help: "Runs started after a failure" },
      { name: "worker_job_timeouts_total", labels, value: job.timeouts, help: "Runs stopped at their timeout" },
      { name: "worker_job_duration_seconds", labels, value: (job.lastDurationMs ?? 0) / 1000, help: "Duration of the job's last run" },
      { name: "worker_job_failures_last_hour", labels, value: failures.get(job.job) ?? 0, help: "Failed attempts recorded in the last hour, outbox events included" },
      { name: "worker_job_lease_expiries_last_hour", labels, value: expiries.get(job.job) ?? 0, help: "Runs or events taken over from a worker that died holding them, in the last hour" },
    );
  }
  return gauges;
}
