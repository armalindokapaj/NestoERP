import { afterAll, afterEach, describe, expect, it } from "vitest";

import { WORKER_GROUPS, findJob } from "@/lib/core/jobs/job.registry";
import { claimOutboxBatch, MAX_ATTEMPTS, retryFailedNotificationEvents } from "@/lib/core/notifications/notification.dispatch";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "../../helpers";
import { COMPANY_A, invokeJob } from "./job-harness";

/**
 * Worker stability for the critical notification path (AUD-07 §8, PS-18).
 *
 * The contract tests in notifications.dispatch.test.ts, documents.scan.test.ts
 * and runner.test.ts prove each rule of PRD #51 on its own. This file proves
 * the AUD-07 story end to end, from the business write to the operator:
 *
 *   1. durable commit → job linkage: the event exists exactly when the
 *      business transaction committed;
 *   2. at-least-once without a duplicate effect: a crash after delivery and a
 *      re-run deliver once;
 *   3. restart: a worker that died holding a whole batch loses none of it;
 *   4. poison: stops at the configured maximum, stays visible with its
 *      history, and an operator's retry sends it round once more.
 *
 * Every event is a task assignment about the seeded task_002 for its owner, so
 * a delivery is one notification whose dedupe key ends in the assignment
 * version. Events are dated long ago so they head the queue.
 */

const JOB = "notifications.dispatch";
const PREFIX = `aud07_worker_${process.pid}_${Date.now().toString(36)}`;
const MINUTE = 60_000;
const QUEUE_START = Date.parse("2001-01-02T00:00:00.000Z");
const TARGET = { memberId: "member_owner", taskId: "task_002", projectId: "project_a" };
let sequence = 0;

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { dedupeKey: { contains: PREFIX } } });
  const events = await prisma.notificationEventOutbox.findMany({ where: { payloadJson: { path: ["assignmentVersion"], string_starts_with: PREFIX } }, select: { id: true } });
  await prisma.jobFailure.deleteMany({ where: { sourceType: "notification_event", sourceId: { in: events.map((row) => row.id) } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { id: { in: events.map((row) => row.id) } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function version(): string {
  sequence += 1;
  return `${PREFIX}_${sequence}`;
}

/** The business write and its event, in one transaction — as every service enqueues (PRD #25 §25). */
async function assignInTransaction(assignmentVersion: string, fail = false): Promise<void> {
  await runInTransaction("aud07.worker.assign", async (tx) => {
    await enqueueNotificationEvent(tx, {
      companyId: COMPANY_A,
      eventType: "TASK_ASSIGNED",
      moduleKey: "tasks",
      entityType: "task",
      entityId: TARGET.taskId,
      projectId: TARGET.projectId,
      payload: { title: "AUD-07 worker stability", assigneeMemberId: TARGET.memberId, assignmentVersion },
    });
    if (fail) throw new Error("the business write failed after enqueueing");
  });
}

const eventsFor = (assignmentVersion: string) =>
  prisma.notificationEventOutbox.findMany({
    where: { payloadJson: { path: ["assignmentVersion"], equals: assignmentVersion } },
    select: { id: true, status: true, attemptCount: true, lockedBy: true, lastErrorCode: true, failedAt: true, manualRetries: true },
  });

const delivered = (assignmentVersion: string) => prisma.notification.count({ where: { dedupeKey: { endsWith: `:${assignmentVersion}` } } });

async function headOfQueue(assignmentVersion: string): Promise<string> {
  const [row] = await eventsFor(assignmentVersion);
  sequence += 1;
  await prisma.notificationEventOutbox.update({ where: { id: row.id }, data: { createdAt: new Date(QUEUE_START + sequence * 1000) } });
  return row.id;
}

describe("AUD-07 PS-18: notification delivery survives failures without losing or doubling work", () => {
  it("links the job to the commit: a rolled-back write leaves no event, a committed one exactly one", async () => {
    const rolledBack = version();
    await expect(assignInTransaction(rolledBack, true)).rejects.toThrow("the business write failed");
    expect(await eventsFor(rolledBack)).toEqual([]);

    const committed = version();
    await assignInTransaction(committed);
    expect(await eventsFor(committed)).toEqual([expect.objectContaining({ status: "PENDING", attemptCount: 0 })]);

    await headOfQueue(committed);
    await invokeJob(JOB);
    expect(await delivered(committed)).toBe(1);
    expect(await delivered(rolledBack)).toBe(0);
  });

  it("delivers once when the worker died after delivering but before settling, and when run again", async () => {
    const assignment = version();
    await assignInTransaction(assignment);
    const id = await headOfQueue(assignment);
    await invokeJob(JOB);

    // The crash window: the notification is written, the event still claimed by a dead worker.
    await prisma.notificationEventOutbox.update({
      where: { id },
      data: { status: "PROCESSING", lockedBy: `${PREFIX}:dead`, lockedAt: new Date(Date.now() - 10 * MINUTE), leaseExpiresAt: new Date(Date.now() - MINUTE), processedAt: null },
    });
    await invokeJob(JOB);
    await invokeJob(JOB);

    expect(await delivered(assignment)).toBe(1);
    expect((await eventsFor(assignment))[0]).toMatchObject({ status: "PROCESSED", lockedBy: null });
  });

  it("loses nothing when a worker dies holding a whole batch: the next worker takes it over after the lease", async () => {
    const assignments = [version(), version(), version()];
    for (const assignment of assignments) {
      await assignInTransaction(assignment);
      await headOfQueue(assignment);
    }
    // A worker claims them all, then the process is gone.
    const claimed = await claimOutboxBatch(3, `${PREFIX}:crashed`);
    expect(claimed).toHaveLength(3);
    const ids = claimed.map((row) => row.id);
    expect(await prisma.notificationEventOutbox.count({ where: { id: { in: ids }, status: "PROCESSING", lockedBy: `${PREFIX}:crashed` } })).toBe(3);

    // While the lease is live nobody else takes them.
    await invokeJob(JOB);
    for (const assignment of assignments) expect(await delivered(assignment)).toBe(0);

    // The lease runs out (the registry's two minutes); a restarted worker drains them.
    await prisma.notificationEventOutbox.updateMany({ where: { id: { in: ids } }, data: { leaseExpiresAt: new Date(Date.now() - MINUTE) } });
    await invokeJob(JOB);
    for (const assignment of assignments) {
      expect(await delivered(assignment), assignment).toBe(1);
      expect((await eventsFor(assignment))[0], assignment).toMatchObject({ status: "PROCESSED", attemptCount: 2 });
    }
    // The takeover is on record as a lost lease, for the operator.
    expect(await prisma.jobFailure.count({ where: { sourceType: "notification_event", sourceId: { in: ids }, errorCode: "LEASE_EXPIRED" } })).toBe(3);
  });

  it("stops a poison event at the maximum attempts, keeps it visible, and lets an operator send it round again", async () => {
    const assignment = version();
    await assignInTransaction(assignment);
    const id = await headOfQueue(assignment);
    // A payload from a newer build: retryable, and never deliverable by this one.
    await prisma.notificationEventOutbox.update({ where: { id }, data: { schemaVersion: 2 } });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS + 2; attempt += 1) {
      await invokeJob(JOB);
      await prisma.notificationEventOutbox.updateMany({ where: { id, status: "PENDING" }, data: { nextAttemptAt: new Date(Date.now() - MINUTE) } });
    }

    const [poisoned] = await eventsFor(assignment);
    expect(poisoned).toMatchObject({ status: "FAILED", attemptCount: MAX_ATTEMPTS, lastErrorCode: "UNSUPPORTED_PAYLOAD" });
    expect(poisoned.failedAt).not.toBeNull();
    // Bounded: exactly the maximum attempts, each on record, none after.
    expect(await prisma.jobFailure.count({ where: { sourceType: "notification_event", sourceId: id } })).toBe(MAX_ATTEMPTS);
    expect(await delivered(assignment)).toBe(0);

    // Fixed (here: the payload is readable again), the operator retries it once.
    await prisma.notificationEventOutbox.update({ where: { id }, data: { schemaVersion: 1 } });
    expect(await retryFailedNotificationEvents({ operator: `${PREFIX}:operator`, ids: [id] })).toEqual({ count: 1, ids: [id] });
    await invokeJob(JOB);
    expect(await delivered(assignment)).toBe(1);
    expect((await eventsFor(assignment))[0]).toMatchObject({ status: "PROCESSED", manualRetries: 1 });
    // The history survives the retry.
    expect(await prisma.jobFailure.count({ where: { sourceType: "notification_event", sourceId: id } })).toBe(MAX_ATTEMPTS);
  });

  it("records the attempt limit, concurrency and deadline the runbook quotes", () => {
    const dispatch = findJob(JOB);
    expect(dispatch).toMatchObject({ concurrency: "SINGLETON", leaseSeconds: 120, timeoutSeconds: 300, retry: { maxAttempts: 5 } });
    expect(MAX_ATTEMPTS).toBe(5);
    const scan = findJob("documents.scan");
    expect(scan?.concurrency).toBe("SINGLETON");
    expect(WORKER_GROUPS).toContain("notifications");
  });
});
