import { Prisma } from "@prisma/client";

import { DB_NOW, sqlTimestamp } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { newCorrelationId, newRequestId, runWithRequestContext } from "@/lib/core/observability/request-context";
import { runWithinJob } from "./job.context";
import { classifyJobError, JobError, type ClassifiedError } from "./job.errors";
import { recordJobFailure } from "./job.failures";
import type { JobContext, JobDefinition, JobHandler, JobResult, WorkerGroup } from "./job.registry";
import { JOBS } from "./job.registry";

/**
 * The job runner (PRD #38 §95-§97, PRD #51 §23-§35, §55-§58, §121).
 *
 * A job is claimed before it runs. The claim is one statement against the
 * job's heartbeat row — insert it, or take it over when it is due and nobody
 * holds a live lease — so two workers, or an old and a new worker overlapping
 * in a deploy, cannot both run the same job.
 *
 * While the job runs its lease is extended every third of its length, so a
 * lease only runs out when the worker holding it has died, and then another
 * worker takes the job over within one lease. A worker that finds its lease
 * gone stops the job rather than finishing it alongside the new holder.
 *
 * Every run is bounded by the job's timeout and by shutdown: both abort the
 * signal the handler was given, and a handler that does not return promptly is
 * abandoned with its lease left to expire, never released under it.
 *
 * The same row records the outcome — counts, duration, the last error's code
 * and safe message, consecutive failures — and each failure is also kept in
 * `job_failures`. Health and metrics read the rows; nothing about a job lives
 * only in a process's memory.
 */

export type { JobHandler, JobResult };

export type JobOutcome = {
  job: string;
  status: "success" | "failure" | "skipped" | "lease_lost";
  processed: number;
  durationMs: number;
  correlationId?: string;
  error?: string;
  errorCode?: string;
  dryRun?: boolean;
  detail?: Record<string, unknown>;
};

export type RunOptions = {
  /** Run even if the job is not due yet — still never while another worker holds it (§163). */
  force?: boolean;
  dryRun?: boolean;
  companyIds?: readonly string[] | null;
  /** Shutdown: aborts the run in hand and stops the pass before the next job (§57). */
  signal?: AbortSignal;
  /** Test seams. */
  handlers?: Readonly<Record<string, JobHandler>>;
  env?: NodeJS.ProcessEnv;
  /** How long a handler gets to return after its signal is aborted before it is abandoned. */
  abandonAfterMs?: number;
};

type Claim = { lastSuccessAt: Date | null; consecutiveFailures: number; recoveredFrom: string | null };

/** Claims the job for `owner` if it is due and unleased, by the database's clock. */
export async function claimJob(job: JobDefinition, owner: string, options: { force?: boolean; now?: Date } = {}): Promise<Claim | null> {
  const now = options.now ? sqlTimestamp(options.now) : DB_NOW;
  const force = options.force ?? false;
  const rows = await prisma.$queryRaw<Array<Claim>>`
    WITH previous AS (
      SELECT "leaseOwner" FROM "worker_heartbeats" WHERE "job" = ${job.key}
    )
    INSERT INTO "worker_heartbeats" ("job", "leaseOwner", "leaseExpiresAt", "runStartedAt", "started", "updatedAt")
    VALUES (${job.key}, ${owner}, ${now} + (${job.leaseSeconds} * interval '1 second'), ${now}, 1, ${now})
    ON CONFLICT ("job") DO UPDATE
      SET "leaseOwner" = EXCLUDED."leaseOwner",
          "leaseExpiresAt" = EXCLUDED."leaseExpiresAt",
          "runStartedAt" = EXCLUDED."runStartedAt",
          "started" = "worker_heartbeats"."started" + 1,
          "retries" = "worker_heartbeats"."retries" + CASE WHEN "worker_heartbeats"."consecutiveFailures" > 0 THEN 1 ELSE 0 END,
          "updatedAt" = EXCLUDED."updatedAt"
      WHERE ("worker_heartbeats"."leaseExpiresAt" IS NULL OR "worker_heartbeats"."leaseExpiresAt" < ${now})
        AND (${force} OR "worker_heartbeats"."nextRunAt" IS NULL OR "worker_heartbeats"."nextRunAt" <= ${now})
    RETURNING "lastSuccessAt", "consecutiveFailures", (SELECT "leaseOwner" FROM previous) AS "recoveredFrom"`;
  return rows[0] ?? null;
}

/** Pushes the lease out while the job runs; false when this worker no longer holds it. */
export async function extendJobLease(job: JobDefinition, owner: string): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE "worker_heartbeats"
    SET "leaseExpiresAt" = ${DB_NOW} + (${job.leaseSeconds} * interval '1 second'), "updatedAt" = ${DB_NOW}
    WHERE "job" = ${job.key} AND "leaseOwner" = ${owner} AND "leaseExpiresAt" >= ${DB_NOW}`;
  return updated === 1;
}

/**
 * The delay before the next attempt after `failures` consecutive failures:
 * doubling from the initial delay, capped, with ±20% jitter so workers that
 * failed together do not retry together (§33). Past `maxAttempts` the job is
 * FAILED and waits for its normal schedule instead.
 */
export function retryDelaySeconds(job: JobDefinition, failures: number, random: () => number = Math.random): number {
  if (failures >= job.retry.maxAttempts) return Math.max(job.intervalSeconds, job.retry.maxDelaySeconds);
  const base = Math.min(job.retry.maxDelaySeconds, job.retry.initialDelaySeconds * 2 ** Math.max(0, failures - 1));
  const jittered = base * (0.8 + 0.4 * random());
  return Math.max(1, Math.round(jittered));
}

type Settlement =
  | { kind: "success"; result: JobResult; durationMs: number; correlationId: string; dryRun: boolean }
  | { kind: "failure"; error: ClassifiedError; durationMs: number; correlationId: string; consecutiveFailures: number; releaseLease: boolean };

/** Records the outcome, only if this worker still holds the lease. Returns whether it did. */
async function settle(job: JobDefinition, owner: string, settlement: Settlement): Promise<boolean> {
  if (settlement.kind === "success") {
    const { result, durationMs, correlationId, dryRun } = settlement;
    // A dry run changes nothing, including when the job is next due.
    const nextRun = dryRun ? Prisma.sql`"nextRunAt"` : job.trigger === "MANUAL" ? Prisma.sql`NULL` : Prisma.sql`${DB_NOW} + (${job.intervalSeconds} * interval '1 second')`;
    const updated = await prisma.$executeRaw`
      UPDATE "worker_heartbeats"
      SET "lastRunAt" = ${DB_NOW},
          "lastSuccessAt" = CASE WHEN ${dryRun} THEN "lastSuccessAt" ELSE ${DB_NOW} END,
          "lastDurationMs" = ${durationMs},
          "lastProcessed" = ${result.processed},
          "runs" = "runs" + 1,
          "successes" = "successes" + 1,
          "consecutiveFailures" = CASE WHEN ${dryRun} THEN "consecutiveFailures" ELSE 0 END,
          "lastCorrelationId" = ${correlationId},
          "instance" = ${owner},
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "runStartedAt" = NULL,
          "nextRunAt" = ${nextRun},
          "updatedAt" = ${DB_NOW}
      WHERE "job" = ${job.key} AND "leaseOwner" = ${owner}`;
    return updated === 1;
  }

  const { error, durationMs, correlationId, consecutiveFailures, releaseLease } = settlement;
  const delay = retryDelaySeconds(job, consecutiveFailures);
  // An abandoned handler may still be running: its lease is left to expire
  // rather than handed to the next worker underneath it.
  const lease = releaseLease ? Prisma.sql`"leaseOwner" = NULL, "leaseExpiresAt" = NULL,` : Prisma.sql``;
  const updated = await prisma.$executeRaw`
    UPDATE "worker_heartbeats"
    SET "lastRunAt" = ${DB_NOW},
        "lastFailureAt" = ${DB_NOW},
        "lastError" = ${error.message},
        "lastErrorCode" = ${error.code},
        "lastDurationMs" = ${durationMs},
        "runs" = "runs" + 1,
        "failures" = "failures" + 1,
        "timeouts" = "timeouts" + ${error.code === "TIMEOUT" ? 1 : 0},
        "consecutiveFailures" = ${consecutiveFailures},
        "lastCorrelationId" = ${correlationId},
        "instance" = ${owner},
        ${lease}
        "runStartedAt" = NULL,
        "nextRunAt" = ${DB_NOW} + (${delay} * interval '1 second'),
        "updatedAt" = ${DB_NOW}
    WHERE "job" = ${job.key} AND "leaseOwner" = ${owner}`;
  return updated === 1;
}

/** Releases a lease this worker holds without recording a run: the job never started. */
export async function releaseJobLease(job: JobDefinition, owner: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "worker_heartbeats"
    SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "runStartedAt" = NULL, "updatedAt" = ${DB_NOW}
    WHERE "job" = ${job.key} AND "leaseOwner" = ${owner}`;
}

const DEFAULT_ABANDON_AFTER_MS = 5_000;

/** Runs one job under a claim it already holds, and records the outcome. */
async function runClaimed(job: JobDefinition, owner: string, claim: Claim, options: RunOptions): Promise<JobOutcome> {
  const started = Date.now();
  const correlationId = newCorrelationId();
  const runId = newRequestId();
  const dryRun = Boolean(options.dryRun && job.dryRun);
  const handlers = options.handlers ?? (await import("./job.handlers")).JOB_HANDLERS;
  const env = options.env ?? process.env;

  const controller = new AbortController();
  const abort = (reason: JobError) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onShutdown = () => abort(new JobError("ABORTED", `${job.key} stopped for shutdown`));
  if (options.signal?.aborted) onShutdown();
  options.signal?.addEventListener("abort", onShutdown, { once: true });

  const timeout = setTimeout(() => abort(new JobError("TIMEOUT", `${job.key} ran past its ${job.timeoutSeconds}s timeout`)), job.timeoutSeconds * 1000);
  const extender = setInterval(() => {
    extendJobLease(job, owner)
      .then((held) => {
        if (!held) abort(new JobError("LEASE_EXPIRED", `${job.key} lost its lease to another worker`));
      })
      .catch((error) => logger.warn("worker.job.lease_extend_failed", { job: job.key, error: error instanceof Error ? error.message : "unknown" }));
  }, Math.max(1_000, Math.floor((job.leaseSeconds * 1000) / 3)));

  const context: JobContext = {
    now: new Date(),
    lastSuccessAt: claim.lastSuccessAt,
    env,
    signal: controller.signal,
    dryRun,
    companyIds: options.companyIds ?? null,
    correlationId,
    workerId: owner,
  };
  const requestContext = { requestId: runId, correlationId, startedAt: started, route: `job:${job.key}`, jobKey: job.key, workerId: owner };
  const logBase = { job: job.key, jobId: runId, workerId: owner, correlationId, attempt: claim.consecutiveFailures + 1, dryRun };

  return runWithRequestContext(requestContext, async () => {
    if (claim.recoveredFrom && claim.recoveredFrom !== owner) {
      // The last holder died holding the job: a crash, counted where operators look (§124 "repeated lease expiry").
      logger.warn("worker.job.lease_recovered", { ...logBase, previousOwner: claim.recoveredFrom });
      await recordJobFailure({
        jobKey: job.key,
        sourceType: "job",
        sourceId: job.key,
        attempt: claim.consecutiveFailures,
        error: { code: "LEASE_EXPIRED", retryable: true, message: `lease held by ${claim.recoveredFrom} expired; the run was taken over` },
        correlationId,
        workerId: owner,
      }).catch(() => undefined);
    }
    logger.info("worker.job.started", logBase);

    let abandoned = false;
    try {
      const handler = handlers[job.key];
      if (!handler) throw new JobError("CONFIGURATION", `No handler registered for job ${job.key}`);

      const run = runWithinJob(
        { jobKey: job.key, runId, correlationId, workerId: owner, signal: controller.signal, companyIds: options.companyIds ?? null, dryRun },
        () => handler(context),
      );
      // Abort does not stop a promise; it asks. A handler that has not
      // returned a few seconds after being asked is left behind.
      const stopped = new Promise<never>((_, reject) => {
        const onAbort = () =>
          setTimeout(() => {
            abandoned = true;
            reject(controller.signal.reason);
          }, options.abandonAfterMs ?? DEFAULT_ABANDON_AFTER_MS);
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      run.catch(() => undefined);
      const result = await Promise.race([run, stopped]);

      // A handler that swallowed its abort and returned still did not finish.
      if (controller.signal.aborted) throw controller.signal.reason;

      const durationMs = Date.now() - started;
      const held = await settle(job, owner, { kind: "success", result, durationMs, correlationId, dryRun });
      if (!held) {
        logger.warn("worker.job.lease_lost", { ...logBase, durationMs, outcome: "success" });
        return { job: job.key, status: "lease_lost", processed: result.processed, durationMs, correlationId, dryRun };
      }
      incrementCounter(Metric.WORKER_JOB_SUCCESS, { job: job.key });
      logger.info("worker.job.completed", { ...logBase, durationMs, outcome: "success", processed: result.processed, ...(result.detail ?? {}) });
      return { job: job.key, status: "success", processed: result.processed, durationMs, correlationId, dryRun, detail: result.detail };
    } catch (caught) {
      const durationMs = Date.now() - started;
      const error = classifyJobError(caught);

      if (error.code === "ABORTED" && !abandoned) {
        // Shutdown reached a job that stopped cleanly: not a failure, and the
        // job is due again at once for whichever worker is still running.
        await prisma.$executeRaw`
          UPDATE "worker_heartbeats"
          SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "runStartedAt" = NULL, "nextRunAt" = ${DB_NOW}, "updatedAt" = ${DB_NOW}
          WHERE "job" = ${job.key} AND "leaseOwner" = ${owner}`;
        logger.info("worker.job.released", { ...logBase, durationMs, outcome: "released" });
        return { job: job.key, status: "skipped", processed: 0, durationMs, correlationId, error: error.message, errorCode: error.code };
      }

      const consecutiveFailures = claim.consecutiveFailures + 1;
      const held =
        error.code === "LEASE_EXPIRED"
          ? false
          : await settle(job, owner, { kind: "failure", error, durationMs, correlationId, consecutiveFailures, releaseLease: !abandoned });
      await recordJobFailure({ jobKey: job.key, sourceType: "job", sourceId: job.key, attempt: consecutiveFailures, error, correlationId, workerId: owner }).catch(
        (recordError) => logger.error("worker.job.failure_not_recorded", { ...logBase, error: recordError instanceof Error ? recordError.message : "unknown" }),
      );
      incrementCounter(Metric.WORKER_JOB_FAILURE, { job: job.key });
      const exhausted = consecutiveFailures >= job.retry.maxAttempts;
      logger.error(exhausted ? "worker.job.failed_permanently" : "worker.job.failed", {
        ...logBase,
        durationMs,
        outcome: held ? "failure" : "lease_lost",
        errorCode: error.code,
        error: error.message,
        retryable: error.retryable,
        consecutiveFailures,
        abandoned,
      });
      return { job: job.key, status: held ? "failure" : "lease_lost", processed: 0, durationMs, correlationId, error: error.message, errorCode: error.code };
    } finally {
      clearTimeout(timeout);
      clearInterval(extender);
      options.signal?.removeEventListener("abort", onShutdown);
    }
  });
}

/** Claims and runs one job if it is due (or, with `force`, whenever nobody else holds it). */
export async function runJobIfDue(job: JobDefinition, owner: string, options: RunOptions = {}): Promise<JobOutcome> {
  if (options.signal?.aborted) return { job: job.key, status: "skipped", processed: 0, durationMs: 0 };
  // A MANUAL job is never due by itself.
  if (job.trigger === "MANUAL" && !options.force) return { job: job.key, status: "skipped", processed: 0, durationMs: 0 };
  const claim = await claimJob(job, owner, { force: options.force });
  if (!claim) return { job: job.key, status: "skipped", processed: 0, durationMs: 0 };
  // Shutdown arrived while the claim was in flight: give it straight back.
  if (options.signal?.aborted) {
    await releaseJobLease(job, owner);
    return { job: job.key, status: "skipped", processed: 0, durationMs: 0 };
  }
  return runClaimed(job, owner, claim, options);
}

/**
 * One pass over every due job in the given groups, stopping between jobs once
 * the signal is aborted (§57, §196).
 */
export async function runDueJobs(
  groups: readonly WorkerGroup[],
  owner: string,
  options: RunOptions & { only?: string; jobs?: readonly JobDefinition[]; isAvailable?: (job: JobDefinition) => boolean; onJob?: (job: string | null) => void } = {},
): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (const job of options.jobs ?? JOBS) {
    if (options.signal?.aborted) break;
    if (!groups.includes(job.group)) continue;
    if (options.only && job.key !== options.only) continue;
    if (options.isAvailable && !options.isAvailable(job)) continue;
    options.onJob?.(job.key);
    try {
      outcomes.push(await runJobIfDue(job, owner, options));
    } finally {
      options.onJob?.(null);
    }
  }
  return outcomes;
}
