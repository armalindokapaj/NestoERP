import { logger } from "@/lib/core/observability/logger";
import type { JobDefinition, JobHandler, WorkerGroup } from "./job.registry";
import { runDueJobs, type JobOutcome } from "./job.runner";
import { beatWorkerProcess, markWorkerProcess, PROCESS_BEAT_SECONDS, pruneWorkerProcesses, registerWorkerProcess } from "./worker.process";

/**
 * A worker process's life, apart from its command line so it can be run and
 * stopped in a test (PRD #51 §57, §58, §116, §196).
 *
 * register → beat on a fixed interval, idle or not → pass over due jobs,
 * pausing between passes → on abort: stop claiming, let the job in hand stop
 * or be abandoned, mark the process STOPPED.
 *
 * The caller owns the signal and the overall shutdown deadline; this never
 * calls `process.exit`.
 */

export type WorkerOptions = {
  workerId: string;
  groups: readonly WorkerGroup[];
  signal: AbortSignal;
  only?: string;
  /** One pass, then return (a platform cron invocation, or a manual pass). */
  once?: boolean;
  tickMs?: number;
  version?: string;
  isAvailable?: (job: JobDefinition) => boolean;
  /** How long the job in hand gets to stop after the signal before it is abandoned. */
  abandonAfterMs?: number;
  /** Test seams. */
  jobs?: readonly JobDefinition[];
  handlers?: Readonly<Record<string, JobHandler>>;
  beatMs?: number;
};

const DEFAULT_TICK_MS = 5_000;

export async function runWorker(options: WorkerOptions): Promise<JobOutcome[]> {
  const { workerId, signal } = options;
  let currentJob: string | null = null;
  const outcomes: JobOutcome[] = [];

  await registerWorkerProcess({ workerId, groups: options.groups, version: options.version });
  await pruneWorkerProcesses().catch(() => 0);
  logger.info("worker.process.started", { workerId, groups: options.groups, once: Boolean(options.once) });

  const beat = setInterval(() => {
    beatWorkerProcess(workerId, currentJob).catch((error) =>
      logger.warn("worker.process.heartbeat_failed", { workerId, error: error instanceof Error ? error.message : "unknown" }),
    );
  }, options.beatMs ?? PROCESS_BEAT_SECONDS * 1000);

  const onAbort = () => {
    logger.info("worker.process.stopping", { workerId, currentJob });
    markWorkerProcess(workerId, "STOPPING").catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    do {
      try {
        const pass = await runDueJobs(options.groups, workerId, {
          signal,
          only: options.only,
          jobs: options.jobs,
          handlers: options.handlers,
          isAvailable: options.isAvailable,
          abandonAfterMs: options.abandonAfterMs,
          onJob: (job) => {
            currentJob = job;
          },
        });
        if (options.once) outcomes.push(...pass);
      } catch (error) {
        // The runner records job failures itself; this is the database going away.
        logger.error("worker.pass.failed", { workerId, error: error instanceof Error ? error.message : "unknown" });
        if (options.once) throw error;
      }
      if (options.once) break;
      await pause(options.tickMs ?? DEFAULT_TICK_MS, signal);
    } while (!signal.aborted);
  } finally {
    clearInterval(beat);
    signal.removeEventListener("abort", onAbort);
    await markWorkerProcess(workerId, "STOPPED").catch(() => undefined);
    logger.info("worker.process.stopped", { workerId });
  }
  return outcomes;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
