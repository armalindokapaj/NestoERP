/**
 * Background jobs (PRD #38 §93-§97).
 *
 * Every job the deployment depends on, with how often it is due and which
 * worker group runs it. The groups let one process run everything in a small
 * deployment, or separate processes isolate a slow scanner from notification
 * delivery in a larger one (PRD #38 §94). Either way a job runs on one worker
 * at a time: the runner claims a lease before starting it (PRD #38 §96).
 *
 * Every job is idempotent — safe to run twice, safe to be interrupted.
 */

export const WORKER_GROUPS = ["notifications", "documents", "scheduled"] as const;
export type WorkerGroup = (typeof WORKER_GROUPS)[number];

export type JobContext = { now: Date; lastSuccessAt: Date | null; env: NodeJS.ProcessEnv };

/** When a job runs and who runs it — no implementation, so health checks can read it cheaply. */
export type JobSchedule = {
  key: string;
  group: WorkerGroup;
  /** How long after a run finishes before the job is due again. */
  intervalSeconds: number;
  /** A claim older than this is treated as a crashed worker's and taken over. */
  leaseSeconds: number;
  /** How stale the last success may be before health reports the job degraded. */
  staleAfterSeconds: number;
};

export type JobResult = { processed: number; detail?: Record<string, unknown> };
export type JobHandler = (context: JobContext) => Promise<JobResult>;

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const JOBS: JobSchedule[] = [
  { key: "notifications.dispatch", group: "notifications", intervalSeconds: 10, leaseSeconds: 5 * MINUTE, staleAfterSeconds: 10 * MINUTE },
  { key: "calendar.reminders", group: "notifications", intervalSeconds: 60, leaseSeconds: 5 * MINUTE, staleAfterSeconds: 10 * MINUTE },
  { key: "notifications.due", group: "scheduled", intervalSeconds: HOUR, leaseSeconds: 15 * MINUTE, staleAfterSeconds: 3 * HOUR },
  { key: "attention.reconcile", group: "scheduled", intervalSeconds: 5 * MINUTE, leaseSeconds: 30 * MINUTE, staleAfterSeconds: 30 * MINUTE },
  { key: "documents.scan", group: "documents", intervalSeconds: 15, leaseSeconds: 15 * MINUTE, staleAfterSeconds: 15 * MINUTE },
  { key: "storage.cleanup", group: "documents", intervalSeconds: 15 * MINUTE, leaseSeconds: 30 * MINUTE, staleAfterSeconds: 2 * HOUR },
  { key: "storage.orphans", group: "documents", intervalSeconds: 24 * HOUR, leaseSeconds: HOUR, staleAfterSeconds: 49 * HOUR },
  { key: "retention.run", group: "scheduled", intervalSeconds: 24 * HOUR, leaseSeconds: 2 * HOUR, staleAfterSeconds: 49 * HOUR },
  { key: "security.throttle-purge", group: "scheduled", intervalSeconds: HOUR, leaseSeconds: 10 * MINUTE, staleAfterSeconds: 3 * HOUR },
];

export function findJob(key: string): JobSchedule | undefined {
  return JOBS.find((job) => job.key === key);
}
