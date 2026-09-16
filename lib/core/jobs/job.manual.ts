import { findJob, jobUnavailableReason, type JobDefinition } from "./job.registry";
import { runJobIfDue, type JobOutcome } from "./job.runner";
import { newWorkerId } from "./worker.process";

/**
 * Running a job now, on an operator's word (PRD #51 §163-§166).
 *
 * A manual run is the scheduled run brought forward, not a second way in: it
 * takes the job's lease, so it never runs alongside a worker that holds the
 * job, and it is bounded by the same timeout and recorded in the same
 * heartbeat and failure history. `pnpm worker --run` and the older
 * single-purpose commands (`notifications:dispatch`, `retention:dry-run`,
 * `storage:maintenance`) all come through here.
 */

export type ManualRunOptions = {
  dryRun?: boolean;
  /** For a COMPANY-scoped job: only these companies (§164). */
  companyIds?: readonly string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  capabilities?: { scanner: boolean };
};

export type ManualRunOutcome = JobOutcome & {
  /** Another worker held the job, so nothing ran. */
  busy: boolean;
};

/** Why this run cannot be asked for, or null when it can. */
export function manualRunRefusal(job: JobDefinition, options: ManualRunOptions): string | null {
  if (options.dryRun && !job.dryRun) return `${job.key} does not support a dry run`;
  if (options.companyIds?.length && job.companyScope !== "COMPANY") {
    return `${job.key} is ${job.companyScope}-scoped; choosing companies applies to COMPANY-scoped jobs only`;
  }
  const reason = jobUnavailableReason(job, { env: options.env, capabilities: options.capabilities });
  return reason ? `${job.key} is not available here: ${reason}` : null;
}

export async function runJobNow(key: string, options: ManualRunOptions = {}): Promise<ManualRunOutcome> {
  const job = findJob(key);
  if (!job) throw new Error(`Unknown job: ${key}`);
  const refusal = manualRunRefusal(job, options);
  if (refusal) throw new Error(refusal);

  const outcome = await runJobIfDue(job, newWorkerId(), {
    force: true,
    dryRun: options.dryRun,
    companyIds: options.companyIds?.length ? options.companyIds : null,
    env: options.env,
    signal: options.signal,
  });
  // A run that started always has a correlation id; a skip without one never claimed the lease.
  return { ...outcome, busy: outcome.status === "skipped" && !outcome.correlationId };
}
