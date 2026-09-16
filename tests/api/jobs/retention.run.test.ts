import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { prisma as client } from "@/lib/database/prisma";
import { findRetentionPolicy, retentionPolicies } from "@/lib/core/retention/retention-policy.registry";
import { prisma } from "../../helpers";
import { COMPANY_A, invokeJob } from "./job-harness";

/**
 * `retention.run` (PRD #33 §68-§74, PRD #51 §132-§137, §165, §226-§230).
 *
 * The fixtures are the operational rows PRD #51 gave policies to — failure
 * history, idempotency keys, worker processes, settled outbox events — and a
 * throttle window, each once past its policy's cutoff and once inside it, all
 * named with this file's prefix and removed after each test. Applying retention
 * here also clears whatever else in the test database is genuinely past a
 * cutoff, which is what the job is for.
 */

const JOB = "retention.run";
const PREFIX = `jobtest_retention_${process.pid}_${Date.now().toString(36)}`;
const DAY = 86_400_000;
const APPLY = { ...process.env, WORKER_RETENTION_APPLY: "true" };

const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

function outbox(name: string, data: { status: "FAILED" | "PROCESSED"; failedAt?: Date; processedAt?: Date }) {
  return { id: `${PREFIX}_${name}`, companyId: COMPANY_A, eventType: "TASK_ASSIGNED", moduleKey: "tasks", entityType: "task", entityId: `${PREFIX}_${name}`, payloadJson: {}, ...data };
}

function workerProcess(name: string, lastHeartbeatAt: Date) {
  return { workerId: `${PREFIX}:${name}`, hostname: "contract-test", pid: 1, version: "test", groups: ["scheduled"], status: "STOPPED" as const, startedAt: lastHeartbeatAt, lastHeartbeatAt, stoppedAt: lastHeartbeatAt };
}

/** One row past each policy's cutoff and one inside it. */
async function debris(): Promise<void> {
  const failure = { jobKey: PREFIX, sourceType: "job", sourceId: PREFIX, attempt: 1, errorCode: "UNKNOWN", errorMessage: "retention contract", retryable: true };
  await prisma.jobFailure.createMany({
    data: [
      { ...failure, id: `${PREFIX}_failure_old`, failedAt: daysAgo(181) },
      { ...failure, id: `${PREFIX}_failure_kept`, failedAt: daysAgo(170) },
    ],
  });
  await prisma.jobIdempotencyKey.createMany({
    data: [
      { companyId: COMPANY_A, jobKey: PREFIX, key: "old", createdAt: daysAgo(401) },
      // Past the read-notification purge and still remembered: the reminder is not sent again.
      { companyId: COMPANY_A, jobKey: PREFIX, key: "kept", createdAt: daysAgo(380) },
    ],
  });
  await prisma.workerProcess.createMany({ data: [workerProcess("old", daysAgo(8)), workerProcess("kept", daysAgo(6))] });
  await prisma.notificationEventOutbox.createMany({
    data: [
      outbox("failed_old", { status: "FAILED", failedAt: daysAgo(181) }),
      // Long past the processed policy's thirty days: a failure is kept for its own.
      outbox("failed_kept", { status: "FAILED", failedAt: daysAgo(170) }),
      outbox("processed_old", { status: "PROCESSED", processedAt: daysAgo(31) }),
      outbox("processed_kept", { status: "PROCESSED", processedAt: daysAgo(20) }),
    ],
  });
  await prisma.rateLimitBucket.createMany({
    data: [
      { key: `${PREFIX}:old`, count: 1, windowEndsAt: daysAgo(2) },
      { key: `${PREFIX}:kept`, count: 1, windowEndsAt: new Date(Date.now() - 3_600_000) },
    ],
  });
}

const EVERYTHING = [
  "bucket:kept", "bucket:old",
  "event:failed_kept", "event:failed_old", "event:processed_kept", "event:processed_old",
  "failure:kept", "failure:old",
  "key:kept", "key:old",
  "process:kept", "process:old",
];
const KEPT = EVERYTHING.filter((name) => name.endsWith("kept"));

/** Which fixtures still exist, by kind and name. */
async function remaining(): Promise<string[]> {
  const [failures, keys, processes, events, buckets] = await Promise.all([
    prisma.jobFailure.findMany({ where: { jobKey: PREFIX }, select: { id: true } }),
    prisma.jobIdempotencyKey.findMany({ where: { jobKey: PREFIX }, select: { key: true } }),
    prisma.workerProcess.findMany({ where: { workerId: { startsWith: `${PREFIX}:` } }, select: { workerId: true } }),
    prisma.notificationEventOutbox.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true } }),
    prisma.rateLimitBucket.findMany({ where: { key: { startsWith: `${PREFIX}:` } }, select: { key: true } }),
  ]);
  const suffix = (value: string) => value.slice(PREFIX.length + 1);
  return [
    ...failures.map((row) => `failure:${suffix(row.id).replace("failure_", "")}`),
    ...keys.map((row) => `key:${row.key}`),
    ...processes.map((row) => `process:${suffix(row.workerId)}`),
    ...events.map((row) => `event:${suffix(row.id)}`),
    ...buckets.map((row) => `bucket:${suffix(row.key)}`),
  ].sort();
}

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.jobFailure.deleteMany({ where: { jobKey: PREFIX } });
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: PREFIX } });
  await prisma.workerProcess.deleteMany({ where: { workerId: { startsWith: `${PREFIX}:` } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: `${PREFIX}:` } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("retention.run", () => {
  describe("idempotency", () => {
    it("removes what is past each policy's cutoff, keeps what is not, and a second run removes nothing more (§228)", async () => {
      await debris();

      const first = await invokeJob(JOB, { env: APPLY });
      expect(first.detail).toMatchObject({ dryRun: false });
      expect(first.processed).toBeGreaterThanOrEqual(6);
      expect(await remaining()).toEqual(KEPT);

      await invokeJob(JOB, { env: APPLY });
      expect(await remaining()).toEqual(KEPT);
    });
  });

  describe("dry run", () => {
    it("counts what would go and deletes nothing, whether asked for or because the deployment has not opted in (§165)", async () => {
      await debris();

      const asked = await invokeJob(JOB, { env: APPLY, dryRun: true });
      const notOptedIn = await invokeJob(JOB, { env: { ...process.env, WORKER_RETENTION_APPLY: "false" } });

      expect(asked.detail).toMatchObject({ dryRun: true });
      expect(notOptedIn.detail).toMatchObject({ dryRun: true });
      expect(asked.processed).toBeGreaterThanOrEqual(6);
      expect(await remaining()).toEqual(EVERYTHING);
      // Every purging policy reports what it would remove; none is quietly left out.
      const purging = retentionPolicies().filter((policy) => policy.deleteMode !== "NONE").map((policy) => policy.key);
      expect(Object.keys((asked.detail as { policies: Record<string, number> }).policies)).toEqual(purging);
    });
  });

  describe("failure", () => {
    it("a policy that fails costs the others nothing, loses none of its own rows, and fails the run (§30-§36)", async () => {
      await debris();
      vi.spyOn(client.jobFailure, "deleteMany").mockRejectedValue(new Error("connection reset while deleting"));

      await expect(invokeJob(JOB, { env: APPLY })).rejects.toMatchObject({ code: "PARTIAL_FAILURE", message: expect.stringContaining("job-failures") });

      // Every policy before and after the broken one ran.
      expect(await remaining()).toEqual([...KEPT, "failure:old"].sort());

      vi.restoreAllMocks();
      await invokeJob(JOB, { env: APPLY });
      expect(await remaining()).toEqual(KEPT);
    });

    it("stops between batches when the run is told to stop, and the next run finishes the policy (§57, §133, §136)", async () => {
      const batch = findRetentionPolicy("worker-processes.stopped")!.batchSize;
      await prisma.workerProcess.createMany({ data: Array.from({ length: batch + 200 }, (_, index) => workerProcess(`stale-${index}`, daysAgo(30))) });
      await prisma.rateLimitBucket.create({ data: { key: `${PREFIX}:old`, count: 1, windowEndsAt: daysAgo(2) } });

      const controller = new AbortController();
      const deleteMany = client.workerProcess.deleteMany.bind(client.workerProcess);
      vi.spyOn(client.workerProcess, "deleteMany").mockImplementation((async (args: Parameters<typeof deleteMany>[0]) => {
        const deleted = await deleteMany(args);
        controller.abort();
        return deleted;
      }) as never);

      await invokeJob(JOB, { env: APPLY, signal: controller.signal });

      const stale = () => prisma.workerProcess.count({ where: { workerId: { startsWith: `${PREFIX}:stale-` } } });
      expect(await stale()).toBeGreaterThanOrEqual(200);
      expect(await stale()).toBeLessThan(batch + 200);
      // The policies after it were not started.
      expect(await remaining()).toContain("bucket:old");

      vi.restoreAllMocks();
      await invokeJob(JOB, { env: APPLY });
      expect(await stale()).toBe(0);
      expect(await remaining()).not.toContain("bucket:old");
    });
  });
});
