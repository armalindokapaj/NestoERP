import { prisma } from "@/lib/database/prisma";
import { JOBS, type WorkerGroup } from "./job.registry";

export type JobHealth = {
  job: string;
  group: WorkerGroup;
  state: "ok" | "stale" | "failing" | "never_run";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAgeSeconds: number | null;
};

/** Where every job stands, read from the heartbeat rows (PRD #38 §97, §104). */
export async function jobHealth(now: Date = new Date()): Promise<JobHealth[]> {
  const rows = await prisma.workerHeartbeat.findMany({
    select: { job: true, lastSuccessAt: true, lastFailureAt: true },
  });
  const byJob = new Map(rows.map((row) => [row.job, row]));

  return JOBS.map((job) => {
    const row = byJob.get(job.key);
    const age = row?.lastSuccessAt ? Math.round((now.getTime() - row.lastSuccessAt.getTime()) / 1000) : null;
    const failingNow = Boolean(row?.lastFailureAt && (!row.lastSuccessAt || row.lastFailureAt > row.lastSuccessAt));
    const state: JobHealth["state"] = !row?.lastSuccessAt
      ? failingNow
        ? "failing"
        : "never_run"
      : failingNow
        ? "failing"
        : age !== null && age > job.staleAfterSeconds
          ? "stale"
          : "ok";
    return {
      job: job.key,
      group: job.group,
      state,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: row?.lastFailureAt?.toISOString() ?? null,
      lastSuccessAgeSeconds: age,
    };
  });
}
