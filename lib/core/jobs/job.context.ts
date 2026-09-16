import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The run a piece of code is part of (PRD #51 §12-§14, §57, §164).
 *
 * The runner opens one for every job run. Code far below it — `forEachCompany`,
 * a service writing audit, the outbox — reads it rather than having every job
 * signature grow a parameter: which job, which correlation id, whether an
 * operator narrowed the run to some companies, and whether the run has been
 * told to stop.
 */
export type JobRun = {
  jobKey: string;
  runId: string;
  correlationId: string;
  workerId: string;
  signal: AbortSignal;
  companyIds: readonly string[] | null;
  dryRun: boolean;
};

const storage = new AsyncLocalStorage<JobRun>();

export function runWithinJob<T>(run: JobRun, fn: () => Promise<T>): Promise<T> {
  return storage.run(run, fn);
}

export function currentJobRun(): JobRun | undefined {
  return storage.getStore();
}

/** True once the run has been told to stop: shutdown, timeout or a lost lease. */
export function jobStopRequested(): boolean {
  return currentJobRun()?.signal.aborted ?? false;
}
