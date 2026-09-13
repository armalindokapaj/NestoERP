import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { JOB_HANDLERS } from "./job.handlers";
import { JOBS, type JobSchedule, type WorkerGroup } from "./job.registry";

/**
 * The job runner (PRD #38 §95-§97).
 *
 * A job is claimed before it runs. The claim is one statement against the
 * job's heartbeat row — insert it, or take it over when it is due and nobody
 * holds a live lease — so two workers started side by side cannot both run the
 * same job, and a worker that dies mid-run leaves a lease that simply expires.
 *
 * The same row records the outcome: last run, last success, last failure and
 * its error, duration, how much was processed. Health and metrics read it;
 * nothing about a job's state lives only in a process's memory.
 */

export type JobOutcome = {
  job: string;
  status: "success" | "failure" | "skipped";
  processed: number;
  durationMs: number;
  error?: string;
};

/** Claims the job for `owner` if it is due and unleased. */
export async function claimJob(job: JobSchedule, owner: string, now: Date = new Date()): Promise<{ lastSuccessAt: Date | null } | null> {
  const leaseUntil = new Date(now.getTime() + job.leaseSeconds * 1000);
  const rows = await prisma.$queryRaw<Array<{ lastSuccessAt: Date | null }>>`
    INSERT INTO "worker_heartbeats" ("job", "leaseOwner", "leaseExpiresAt", "updatedAt")
    VALUES (${job.key}, ${owner}, ${leaseUntil}, ${now})
    ON CONFLICT ("job") DO UPDATE
      SET "leaseOwner" = EXCLUDED."leaseOwner",
          "leaseExpiresAt" = EXCLUDED."leaseExpiresAt",
          "updatedAt" = EXCLUDED."updatedAt"
      WHERE ("worker_heartbeats"."leaseExpiresAt" IS NULL OR "worker_heartbeats"."leaseExpiresAt" < ${now})
        AND ("worker_heartbeats"."nextRunAt" IS NULL OR "worker_heartbeats"."nextRunAt" <= ${now})
    RETURNING "lastSuccessAt"`;
  return rows[0] ?? null;
}

/** Errors are recorded by message only, trimmed — never a stack, never a payload. */
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return message.replace(/\s+/g, " ").slice(0, 500);
}

/** Runs one job under a claim it already holds, and records the outcome. */
async function runClaimed(job: JobSchedule, owner: string, lastSuccessAt: Date | null): Promise<JobOutcome> {
  const started = Date.now();
  const now = new Date();
  try {
    const handler = JOB_HANDLERS[job.key];
    if (!handler) throw new Error(`No handler registered for job ${job.key}`);
    const result = await handler({ now, lastSuccessAt, env: process.env });
    const durationMs = Date.now() - started;
    const finished = new Date();
    await prisma.workerHeartbeat.updateMany({
      where: { job: job.key, leaseOwner: owner },
      data: {
        lastRunAt: finished,
        lastSuccessAt: finished,
        lastDurationMs: durationMs,
        lastProcessed: result.processed,
        runs: { increment: 1 },
        instance: owner,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextRunAt: new Date(finished.getTime() + job.intervalSeconds * 1000),
      },
    });
    incrementCounter(Metric.WORKER_JOB_SUCCESS, { job: job.key });
    if (result.processed > 0) logger.info("worker.job.completed", { job: job.key, processed: result.processed, durationMs, ...(result.detail ?? {}) });
    return { job: job.key, status: "success", processed: result.processed, durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const finished = new Date();
    const message = safeError(error);
    // A failing job backs off to its interval (at least a minute) rather than
    // spinning on a broken dependency.
    const retryIn = Math.max(job.intervalSeconds, 60);
    await prisma.workerHeartbeat.updateMany({
      where: { job: job.key, leaseOwner: owner },
      data: {
        lastRunAt: finished,
        lastFailureAt: finished,
        lastError: message,
        lastDurationMs: durationMs,
        runs: { increment: 1 },
        failures: { increment: 1 },
        instance: owner,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextRunAt: new Date(finished.getTime() + retryIn * 1000),
      },
    });
    incrementCounter(Metric.WORKER_JOB_FAILURE, { job: job.key });
    logger.error("worker.job.failed", { job: job.key, durationMs, error: message });
    return { job: job.key, status: "failure", processed: 0, durationMs, error: message };
  }
}

/** Claims and runs one job if it is due. */
export async function runJobIfDue(job: JobSchedule, owner: string): Promise<JobOutcome> {
  const claim = await claimJob(job, owner);
  if (!claim) return { job: job.key, status: "skipped", processed: 0, durationMs: 0 };
  return runClaimed(job, owner, claim.lastSuccessAt);
}

/** One pass over every due job in the given groups. */
export async function runDueJobs(groups: readonly WorkerGroup[], owner: string, only?: string): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (const job of JOBS) {
    if (!groups.includes(job.group)) continue;
    if (only && job.key !== only) continue;
    outcomes.push(await runJobIfDue(job, owner));
  }
  return outcomes;
}
