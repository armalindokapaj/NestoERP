import { hostname } from "node:os";

import { Prisma } from "@prisma/client";

import { DB_NOW } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import type { WorkerGroup } from "./job.registry";

/**
 * The worker process's own heartbeat (PRD #51 §25, §114-§118).
 *
 * Written on start, every `PROCESS_BEAT_SECONDS` whether or not a job is due,
 * and on the way out. A process that stops beating for
 * `PROCESS_STALE_SECONDS` is gone, whatever its row says — a SIGKILL writes
 * nothing.
 */

export const PROCESS_BEAT_SECONDS = 15;
export const PROCESS_STALE_SECONDS = 60;

/** Unique per process start: a restarted worker on the same host and pid is a different worker. */
export function newWorkerId(): string {
  return `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
}

/** The build this process runs, so an overlap during a rolling deploy is visible (§60, §197). */
export function workerVersion(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_RELEASE_VERSION ?? env.RELEASE_VERSION ?? env.npm_package_version ?? "unknown").slice(0, 100);
}

export async function registerWorkerProcess(input: { workerId: string; groups: readonly WorkerGroup[]; version?: string }): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "worker_processes" ("workerId", "hostname", "pid", "version", "groups", "status", "startedAt", "lastHeartbeatAt")
    VALUES (${input.workerId}, ${hostname()}, ${process.pid}, ${input.version ?? workerVersion()}, ${[...input.groups]}::text[], 'RUNNING', ${DB_NOW}, ${DB_NOW})
    ON CONFLICT ("workerId") DO UPDATE SET "status" = 'RUNNING', "lastHeartbeatAt" = ${DB_NOW}, "stoppedAt" = NULL`;
}

export async function beatWorkerProcess(workerId: string, currentJob: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "worker_processes" SET "lastHeartbeatAt" = ${DB_NOW}, "currentJob" = ${currentJob}
    WHERE "workerId" = ${workerId} AND "status" <> 'STOPPED'`;
}

export async function markWorkerProcess(workerId: string, status: "STOPPING" | "STOPPED"): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "worker_processes"
    SET "status" = ${status}::"WorkerProcessStatus", "lastHeartbeatAt" = ${DB_NOW}, "currentJob" = NULL,
        "stoppedAt" = ${status === "STOPPED" ? DB_NOW : Prisma.sql`NULL`}
    WHERE "workerId" = ${workerId} AND ${status === "STOPPED" ? Prisma.sql`TRUE` : Prisma.sql`"status" = 'RUNNING'`}`;
}

/** Stopped or silent processes older than a week are history nobody reads (§229). */
export async function pruneWorkerProcesses(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "worker_processes"
    WHERE "lastHeartbeatAt" < ${DB_NOW} - interval '7 days'`;
}

export type LiveWorker = { workerId: string; hostname: string; version: string; groups: string[]; status: string; currentJob: string | null; startedAt: Date; heartbeatAgeSeconds: number };

/** Processes that have beaten recently and have not stopped. */
export async function liveWorkers(): Promise<LiveWorker[]> {
  return prisma.$queryRaw<LiveWorker[]>`
    SELECT "workerId", "hostname", "version", "groups", "status"::text AS "status", "currentJob", "startedAt",
           EXTRACT(EPOCH FROM (${DB_NOW} - "lastHeartbeatAt"))::int AS "heartbeatAgeSeconds"
    FROM "worker_processes"
    WHERE "status" <> 'STOPPED' AND "lastHeartbeatAt" >= ${DB_NOW} - (${PROCESS_STALE_SECONDS} * interval '1 second')
    ORDER BY "startedAt" ASC`;
}
