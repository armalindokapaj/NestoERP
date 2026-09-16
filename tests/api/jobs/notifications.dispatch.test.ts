import type { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { JobError } from "@/lib/core/jobs/job.errors";
import { claimOutboxBatch, dispatchNotifications, MAX_ATTEMPTS, retryFailedNotificationEvents } from "@/lib/core/notifications/notification.dispatch";
import { findNotificationEvent, type NotificationEventDefinition } from "@/lib/core/notifications/notification.events";
import { databaseNow } from "@/lib/database/clock";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus } from "./job-harness";

/**
 * `notifications.dispatch` (PRD #51 §23-§39, §57, §61-§66, §99-§105, §145, §176-§183, §195, §223-§225).
 *
 * Every event is a task assignment written straight into the outbox with its
 * own id, about a seeded task and for a member who can open it, so a delivery
 * is one notification whose dedupe key ends in the event's assignment version.
 * The events are dated long ago so they head the queue in the order they were
 * written; each test removes its events, their notifications and their
 * failure history.
 */

const JOB = "notifications.dispatch";
const PREFIX = `jobtest_dispatch_${process.pid}_${Date.now().toString(36)}`;
const MINUTE = 60_000;
const QUEUE_START = Date.parse("2001-01-01T00:00:00.000Z");

/** Who each company's events are for, and the seeded task they are about. */
const TARGET: Record<string, { memberId: string; taskId: string; projectId: string }> = {
  [COMPANY_A]: { memberId: "member_owner", taskId: "task_002", projectId: "project_a" },
  [COMPANY_B]: { memberId: "member_owner_b", taskId: "task_b_01", projectId: "project_b_one" },
};

let sequence = 0;

type Fixture = Partial<Prisma.NotificationEventOutboxUncheckedCreateInput> & { assignee?: string; version?: string };

async function assignment(companyId: string, fixture: Fixture = {}): Promise<string> {
  const { assignee, version, ...data } = fixture;
  sequence += 1;
  const id = `${PREFIX}_${sequence}`;
  const target = TARGET[companyId];
  await prisma.notificationEventOutbox.create({
    data: {
      id,
      companyId,
      eventType: "TASK_ASSIGNED",
      moduleKey: "tasks",
      entityType: "task",
      entityId: target.taskId,
      projectId: target.projectId,
      payloadJson: { title: `Dispatch contract ${sequence}`, assigneeMemberId: assignee ?? target.memberId, assignmentVersion: version ?? id },
      createdAt: new Date(QUEUE_START + sequence * 1000),
      ...data,
    },
  });
  return id;
}

const event = (id: string) =>
  prisma.notificationEventOutbox.findUniqueOrThrow({
    where: { id },
    select: { status: true, attemptCount: true, nextAttemptAt: true, lockedBy: true, leaseExpiresAt: true, lastErrorCode: true, failedAt: true, manualRetries: true },
  });

/** The notifications an assignment version produced. */
const delivered = (version: string) =>
  prisma.notification.findMany({ where: { dedupeKey: { endsWith: `:${version}` } }, select: { companyId: true, recipientMemberId: true } });

const failures = (id: string) =>
  prisma.jobFailure.findMany({
    where: { sourceType: "notification_event", sourceId: id },
    orderBy: [{ failedAt: "asc" }, { attempt: "asc" }],
    select: { attempt: true, errorCode: true, retryable: true, retriedBy: true, retriedAt: true, companyId: true },
  });

const makeDue = (id: string) => prisma.notificationEventOutbox.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - MINUTE) } });

const assigned = findNotificationEvent("TASK_ASSIGNED") as NotificationEventDefinition;

/** Runs `before` ahead of the real recipient lookup for every event, which is where a test makes one event fail. */
function beforeRecipients(before: (eventId: string) => void) {
  const original = assigned.recipients;
  return vi.spyOn(assigned, "recipients").mockImplementation(async (tx, outbox, payload) => {
    before(outbox.id);
    return original.call(assigned, tx, outbox, payload);
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.notification.deleteMany({ where: { dedupeKey: { contains: PREFIX } } });
  await prisma.jobFailure.deleteMany({ where: { sourceType: "notification_event", sourceId: { startsWith: PREFIX } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { id: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("notifications.dispatch", () => {
  describe("idempotency", () => {
    it("tells the assignee once, even when the worker that delivered died before settling the event (§183)", async () => {
      const id = await assignment(COMPANY_A);

      await invokeJob(JOB);
      expect(await delivered(id)).toEqual([{ companyId: COMPANY_A, recipientMemberId: TARGET[COMPANY_A].memberId }]);

      // As a crash between writing the notification and settling the event leaves it.
      await prisma.notificationEventOutbox.update({
        where: { id },
        data: { status: "PROCESSING", lockedBy: `${PREFIX}:dead`, lockedAt: new Date(Date.now() - 10 * MINUTE), leaseExpiresAt: new Date(Date.now() - MINUTE), processedAt: null },
      });
      await invokeJob(JOB);

      expect(await delivered(id)).toHaveLength(1);
      expect(await event(id)).toMatchObject({ status: "PROCESSED", lockedBy: null, leaseExpiresAt: null });
    });

    it("the same assignment enqueued twice is one notification", async () => {
      const version = `${PREFIX}_shared`;
      const first = await assignment(COMPANY_A, { version });
      const second = await assignment(COMPANY_A, { version });

      await invokeJob(JOB);

      expect((await event(first)).status).toBe("PROCESSED");
      expect((await event(second)).status).toBe("PROCESSED");
      expect(await delivered(version)).toHaveLength(1);
    });
  });

  describe("concurrency", () => {
    it("two dispatchers draining the queue at once deliver every event exactly once (§195)", async () => {
      const ids: string[] = [];
      for (let index = 0; index < 6; index += 1) ids.push(await assignment(index % 2 === 0 ? COMPANY_A : COMPANY_B));
      const lookups = new Map<string, number>();
      beforeRecipients((eventId) => lookups.set(eventId, (lookups.get(eventId) ?? 0) + 1));

      const env = { ...process.env, NOTIFICATION_BATCH_SIZE: "3" };
      const results = await Promise.all([invokeJob(JOB, { env }), invokeJob(JOB, { env })]);

      expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(6);
      for (const id of ids) {
        expect(lookups.get(id), id).toBe(1);
        expect((await event(id)).status, id).toBe("PROCESSED");
        expect(await delivered(id), id).toHaveLength(1);
      }
    });

    it("an event another worker holds under a live lease is not taken (§23, §26)", async () => {
      const id = await assignment(COMPANY_A);
      const holder = `${PREFIX}:worker-a`;

      expect((await claimOutboxBatch(1, holder)).map((row) => row.id)).toEqual([id]);
      await dispatchNotifications(10, `${PREFIX}:worker-b`);

      expect(await event(id)).toMatchObject({ status: "PROCESSING", lockedBy: holder, attemptCount: 1 });
      expect(await delivered(id)).toEqual([]);
    });
  });

  describe("company isolation", () => {
    it("delivers each company's events inside that company only, whoever the payload names (§10, §180)", async () => {
      const inA = await assignment(COMPANY_A);
      const inB = await assignment(COMPANY_B);
      // Company B's event naming company A's member: a producer bug, or a forged payload.
      const crossing = await assignment(COMPANY_B, { assignee: TARGET[COMPANY_A].memberId });

      await invokeJob(JOB);

      expect(await delivered(inA)).toEqual([{ companyId: COMPANY_A, recipientMemberId: TARGET[COMPANY_A].memberId }]);
      expect(await delivered(inB)).toEqual([{ companyId: COMPANY_B, recipientMemberId: TARGET[COMPANY_B].memberId }]);
      expect(await delivered(crossing)).toEqual([]);
      expect((await event(crossing)).status).toBe("PROCESSED");

      const written = await prisma.notification.findMany({ where: { dedupeKey: { contains: PREFIX } }, select: { companyId: true, recipientMemberId: true } });
      const members = await prisma.companyMember.findMany({ where: { id: { in: written.map((row) => row.recipientMemberId) } }, select: { id: true, companyId: true } });
      for (const row of written) {
        expect(members.find((member) => member.id === row.recipientMemberId)?.companyId).toBe(row.companyId);
      }
    });
  });

  describe("suspended company", () => {
    it("settles a suspended company's events without delivering them, and without holding up anyone else's (§145)", async () => {
      const inB = await assignment(COMPANY_B);
      const inA = await assignment(COMPANY_A);
      const looked: string[] = [];
      beforeRecipients((eventId) => looked.push(eventId));

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB));

      expect(await event(inB)).toMatchObject({ status: "PROCESSED", lastErrorCode: null });
      expect(looked).not.toContain(inB);
      expect(await delivered(inB)).toEqual([]);
      expect(await delivered(inA)).toHaveLength(1);

      // Reactivated, the company is not told late about what happened while nobody in it could sign in.
      await invokeJob(JOB);
      expect(await delivered(inB)).toEqual([]);
    });
  });

  describe("failure", () => {
    it("fails a permanent error at once and still delivers the rest of the batch (§32, §35, §36)", async () => {
      const broken = await assignment(COMPANY_A);
      const healthy = await assignment(COMPANY_B);
      beforeRecipients((eventId) => {
        if (eventId === broken) throw new JobError("VALIDATION", "the assignment names no task this build can read");
      });

      const result = await invokeJob(JOB);

      expect(result.detail).toMatchObject({ failed: 1 });
      expect(await event(broken)).toMatchObject({ status: "FAILED", attemptCount: 1, nextAttemptAt: null, lastErrorCode: "VALIDATION", lockedBy: null });
      expect((await event(broken)).failedAt).not.toBeNull();
      expect(await failures(broken)).toEqual([expect.objectContaining({ attempt: 1, errorCode: "VALIDATION", retryable: false, companyId: COMPANY_A })]);
      expect(await delivered(broken)).toEqual([]);
      expect((await event(healthy)).status).toBe("PROCESSED");
      expect(await delivered(healthy)).toHaveLength(1);
    });

    it("waits out a retryable error with a growing delay, then delivers (§31, §33, §177)", async () => {
      const id = await assignment(COMPANY_A);
      let failuresLeft = 1;
      beforeRecipients((eventId) => {
        if (eventId === id && failuresLeft-- > 0) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      });

      await invokeJob(JOB);
      const waiting = await event(id);
      expect(waiting).toMatchObject({ status: "PENDING", attemptCount: 1, lastErrorCode: "NETWORK", failedAt: null, lockedBy: null });
      const delaySeconds = (waiting.nextAttemptAt!.getTime() - (await databaseNow()).getTime()) / 1000;
      // 30 s ±20% for the first retry, on the database's clock.
      expect(delaySeconds).toBeGreaterThan(20);
      expect(delaySeconds).toBeLessThanOrEqual(36);
      expect(await failures(id)).toEqual([expect.objectContaining({ attempt: 1, errorCode: "NETWORK", retryable: true })]);

      // Not before its time.
      await invokeJob(JOB);
      expect((await event(id)).attemptCount).toBe(1);

      await makeDue(id);
      await invokeJob(JOB);
      expect(await event(id)).toMatchObject({ status: "PROCESSED", attemptCount: 2, lastErrorCode: null });
      expect(await delivered(id)).toHaveLength(1);
    });

    it("refuses a payload from a newer build as retryable, visibly (§223-§225)", async () => {
      const id = await assignment(COMPANY_A, { schemaVersion: 2 });

      await invokeJob(JOB);

      expect(await event(id)).toMatchObject({ status: "PENDING", attemptCount: 1, lastErrorCode: "UNSUPPORTED_PAYLOAD" });
      expect(await failures(id)).toEqual([expect.objectContaining({ errorCode: "UNSUPPORTED_PAYLOAD", retryable: true })]);
      expect(await delivered(id)).toEqual([]);
    });

    it("ends FAILED after the maximum attempts, and is not tried again (§34, §178)", async () => {
      const id = await assignment(COMPANY_A, { schemaVersion: 2 });

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        await invokeJob(JOB);
        if (attempt < MAX_ATTEMPTS) {
          expect(await event(id), `attempt ${attempt}`).toMatchObject({ status: "PENDING", attemptCount: attempt });
          await makeDue(id);
        }
      }

      expect(await event(id)).toMatchObject({ status: "FAILED", attemptCount: MAX_ATTEMPTS, nextAttemptAt: null, lastErrorCode: "UNSUPPORTED_PAYLOAD" });
      expect((await failures(id)).map((row) => row.attempt)).toEqual(Array.from({ length: MAX_ATTEMPTS }, (_, index) => index + 1));

      await makeDue(id);
      await invokeJob(JOB);
      expect(await event(id)).toMatchObject({ status: "FAILED", attemptCount: MAX_ATTEMPTS });
      expect(await failures(id)).toHaveLength(MAX_ATTEMPTS);
    });

    it("takes over an event whose worker died holding it, and records the lost lease (§27, §176)", async () => {
      const id = await assignment(COMPANY_A, {
        status: "PROCESSING",
        attemptCount: 1,
        lockedBy: `${PREFIX}:dead`,
        lockedAt: new Date(Date.now() - 10 * MINUTE),
        leaseExpiresAt: new Date(Date.now() - MINUTE),
      });

      await invokeJob(JOB);

      expect(await event(id)).toMatchObject({ status: "PROCESSED", attemptCount: 2, lockedBy: null });
      expect(await delivered(id)).toHaveLength(1);
      expect(await failures(id)).toEqual([expect.objectContaining({ attempt: 1, errorCode: "LEASE_EXPIRED", retryable: true })]);
    });

    it("fails an event whose worker died on its last attempt, and never claims it again (§29, §176, poison)", async () => {
      const id = await assignment(COMPANY_A, {
        status: "PROCESSING",
        attemptCount: MAX_ATTEMPTS,
        lockedBy: `${PREFIX}:dead`,
        lockedAt: new Date(Date.now() - 10 * MINUTE),
        leaseExpiresAt: new Date(Date.now() - MINUTE),
      });

      await invokeJob(JOB);
      await invokeJob(JOB);

      const failed = await event(id);
      expect(failed).toMatchObject({ status: "FAILED", attemptCount: MAX_ATTEMPTS, lastErrorCode: "LEASE_EXPIRED", lockedBy: null, leaseExpiresAt: null });
      expect(failed.failedAt).not.toBeNull();
      expect(await delivered(id)).toEqual([]);
      expect(await failures(id)).toEqual([expect.objectContaining({ attempt: MAX_ATTEMPTS, errorCode: "LEASE_EXPIRED", retryable: false })]);
    });

    it("an operator's retry sends a FAILED event round again and keeps its history (§38, §39, §179)", async () => {
      const id = await assignment(COMPANY_A);
      beforeRecipients((eventId) => {
        if (eventId === id) throw new JobError("STATE_CONFLICT", "the task moved on");
      });
      await invokeJob(JOB);
      expect((await event(id)).status).toBe("FAILED");
      vi.restoreAllMocks();

      expect(await retryFailedNotificationEvents({ operator: `${PREFIX}:operator`, ids: [id] })).toEqual({ count: 1, ids: [id] });
      expect(await event(id)).toMatchObject({ status: "PENDING", attemptCount: 0, manualRetries: 1 });

      await invokeJob(JOB);

      expect(await event(id)).toMatchObject({ status: "PROCESSED", attemptCount: 1, lastErrorCode: null });
      expect(await delivered(id)).toHaveLength(1);
      const history = await failures(id);
      expect(history).toEqual([expect.objectContaining({ attempt: 1, errorCode: "STATE_CONFLICT", retryable: false, retriedBy: `${PREFIX}:operator` })]);
      expect(history[0].retriedAt).not.toBeNull();
      await expect(retryFailedNotificationEvents({ operator: " ", ids: [id] })).rejects.toMatchObject({ code: "CONFIGURATION" });
    });

    it("hands the rest of its claim back on shutdown without spending their attempt (§57)", async () => {
      const first = await assignment(COMPANY_A);
      const second = await assignment(COMPANY_A);
      const third = await assignment(COMPANY_B);
      const controller = new AbortController();
      beforeRecipients((eventId) => {
        if (eventId === first) controller.abort(new JobError("ABORTED", "shutdown"));
      });

      const result = await invokeJob(JOB, { signal: controller.signal });

      // The event in hand is finished; the ones not yet started go straight back.
      expect(result.processed).toBe(1);
      expect((await event(first)).status).toBe("PROCESSED");
      for (const id of [second, third]) {
        expect(await event(id), id).toMatchObject({ status: "PENDING", attemptCount: 0, lockedBy: null, leaseExpiresAt: null });
        expect(await delivered(id), id).toEqual([]);
      }

      vi.restoreAllMocks();
      await invokeJob(JOB);
      expect(await delivered(second)).toHaveLength(1);
      expect(await delivered(third)).toHaveLength(1);
    });
  });
});
