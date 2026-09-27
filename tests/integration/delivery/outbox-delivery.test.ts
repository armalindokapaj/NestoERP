import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { canReadRecord } from "@/lib/core/records/record.registry";
import { claimOutboxBatch, dispatchNotifications, MAX_ATTEMPTS, retryFailedNotificationEvents } from "@/lib/core/notifications/notification.dispatch";
import { newRequestId, runWithRequestContext } from "@/lib/core/observability/request-context";
import { clearOutbox, readOutbox } from "@/lib/mail";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, prisma } from "../../helpers";

/**
 * Honest asynchronous delivery (AUD-10 §7, §8; CW-15, CW-16, CW-17; gap 9).
 *
 * The business change and its outbox event commit together; delivery is a
 * separate, at-least-once worker. These drive the real task service and the
 * real dispatcher against PostgreSQL, and break the worker the ways a worker
 * breaks — a crash after the claim, a crash after writing notifications but
 * before settling, two workers at once, events out of order, a payload no
 * worker can read — and assert, from the rows, that:
 *
 * - the committed change is never redone and never undone by delivery;
 * - each recipient gets one notification per event, however often it is
 *   delivered (the unique dedupe key);
 * - a terminally failed event is inspectable and can be sent round again by
 *   an operator without repeating the business operation;
 * - a recipient who lost the record between the commit and the delivery is
 *   told nothing, in-app or by mail;
 * - command, activity, outbox event, worker attempt and notification carry one
 *   correlation id.
 */

const PROJECT_ID = "aud10d_delivery_project";
const created = new Set<string>();
let pm: UserContext;
let engineer: UserContext;
let engineerEmail: string;

async function newTask(): Promise<string> {
  const task = await tasks.createTask(pm, createTaskSchema.parse({ title: "aud10d delivery", projectId: PROJECT_ID, assigneeMemberId: engineer.membershipId }));
  created.add(task.id);
  return task.id;
}

async function version(taskId: string) {
  return { expectedVersion: (await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { version: true } })).version };
}

async function events(taskId: string, eventType: string) {
  return prisma.notificationEventOutbox.findMany({ where: { entityId: taskId, eventType }, orderBy: { createdAt: "asc" } });
}

async function notifications(taskId: string, eventType: string, memberId = engineer.membershipId) {
  return prisma.notification.findMany({ where: { entityId: taskId, eventType, recipientMemberId: memberId } });
}

/** Everything about the task a delivery could conceivably touch. */
async function businessState(taskId: string) {
  const [task, activity, outbox] = await Promise.all([
    prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, version: true, completedAt: true, assigneeMemberId: true, updatedAt: true } }),
    prisma.activity.findMany({ where: { entityId: taskId }, select: { id: true } }),
    prisma.notificationEventOutbox.count({ where: { entityId: taskId } }),
  ]);
  return { task, activity: activity.map((row) => row.id).sort(), outbox };
}

/** Drains everything due, so a test starts from an empty queue for its own events. */
async function drain() {
  for (let round = 0; round < 5; round += 1) {
    const result = await dispatchNotifications(500, "aud10d-drain");
    if (result.processed + result.failed === 0) return;
  }
}

async function cleanupTasks() {
  const ids = [...created];
  if (ids.length === 0) return;
  const outbox = await prisma.notificationEventOutbox.findMany({ where: { entityId: { in: ids } }, select: { id: true } });
  await prisma.jobFailure.deleteMany({ where: { sourceType: "notification_event", sourceId: { in: outbox.map((row) => row.id) } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: ids } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.comment.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
  created.clear();
}

beforeAll(async () => {
  pm = await loginAs("PROJECT_MANAGER");
  const engineerLogin = await loginAs("ENGINEER");
  // The Engineer's Aurelia membership, where the Project Manager works.
  const membership = await prisma.companyMember.findFirstOrThrow({ where: { userId: engineerLogin.userId, companyId: COMPANY.a, status: "ACTIVE" }, select: { id: true, user: { select: { email: true } } } });
  engineer = await loginAsMembership(membership.id);
  engineerEmail = membership.user.email ?? "";
  await prisma.project.create({ data: { id: PROJECT_ID, companyId: COMPANY.a, code: "AUD10D-DLV", name: "aud10d delivery", status: "ACTIVE", projectManagerMemberId: pm.membershipId, createdBy: "test" } });
  await prisma.projectMember.create({ data: { companyId: COMPANY.a, projectId: PROJECT_ID, companyMemberId: engineer.membershipId, status: "ACTIVE" } });
  await drain();
});

beforeEach(async () => {
  clearOutbox();
  await prisma.projectMember.updateMany({ where: { projectId: PROJECT_ID }, data: { status: "ACTIVE", leftAt: null } });
});

afterAll(async () => {
  await cleanupTasks();
  await prisma.projectMember.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.activity.deleteMany({ where: { OR: [{ entityId: PROJECT_ID }, { metadata: { path: ["projectId"], equals: PROJECT_ID } }] } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("one correlation id from command to notification (gap 9)", () => {
  it("the activity, the outbox event and the notification carry the command's correlation id", async () => {
    const taskId = await newTask();
    await drain();
    const correlationId = "corr_aud10d00000000000000c1";
    await runWithRequestContext({ requestId: newRequestId(), correlationId, startedAt: Date.now() }, async () => {
      await tasks.completeTask(pm, taskId, await version(taskId));
    });

    const activity = await prisma.activity.findFirstOrThrow({ where: { entityId: taskId, action: "TASK_COMPLETED" }, select: { correlationId: true } });
    const [event] = await events(taskId, "TASK_COMPLETED");
    expect(activity.correlationId).toBe(correlationId);
    expect(event.correlationId).toBe(correlationId);

    await dispatchNotifications(500, "aud10d-worker");
    const [notification] = await notifications(taskId, "TASK_COMPLETED");
    expect(notification.correlationId).toBe(correlationId);
  });

  it("outside a request the columns stay empty rather than invented", async () => {
    const taskId = await newTask();
    const activity = await prisma.activity.findFirstOrThrow({ where: { entityId: taskId, action: "TASK_CREATED" }, select: { correlationId: true } });
    expect(activity.correlationId).toBeNull();
  });
});

describe("a worker crash after the claim (CW-16)", () => {
  it("is re-delivered on the next run, once, without a second business effect", async () => {
    const taskId = await newTask();
    await drain();
    const correlationId = "corr_aud10d00000000000000c2";
    await runWithRequestContext({ requestId: newRequestId(), correlationId, startedAt: Date.now() }, async () => {
      await tasks.completeTask(pm, taskId, await version(taskId));
    });
    const [event] = await events(taskId, "TASK_COMPLETED");
    const committed = await businessState(taskId);

    // The first worker claims the event, then dies: its lease runs out with nothing settled.
    const claimed = await claimOutboxBatch(500, "aud10d-crashed-worker");
    expect(claimed.map((row) => row.id)).toContain(event.id);
    await prisma.notificationEventOutbox.updateMany({ where: { lockedBy: "aud10d-crashed-worker" }, data: { leaseExpiresAt: new Date(Date.now() - 60_000) } });
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(0);

    await dispatchNotifications(500, "aud10d-worker-b");

    const settled = await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: event.id } });
    expect(settled).toMatchObject({ status: "PROCESSED", attemptCount: 2, lockedBy: null });
    // The takeover is on the record, under the command's correlation id.
    const failures = await prisma.jobFailure.findMany({ where: { sourceType: "notification_event", sourceId: event.id } });
    expect(failures).toEqual([expect.objectContaining({ errorCode: "LEASE_EXPIRED", retryable: true, correlationId })]);
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(1);
    expect(await businessState(taskId)).toEqual(committed);
  });

  it("a worker that wrote the notifications and died before settling: the next run writes none twice", async () => {
    const taskId = await newTask();
    await drain();
    await tasks.completeTask(pm, taskId, await version(taskId));
    const [event] = await events(taskId, "TASK_COMPLETED");
    await dispatchNotifications(500, "aud10d-worker");
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(1);
    const committed = await businessState(taskId);

    // As the dying worker left it: its notifications written, its row still held, its lease run out.
    await prisma.notificationEventOutbox.update({
      where: { id: event.id },
      data: { status: "PROCESSING", lockedBy: "aud10d-dead-worker", lockedAt: new Date(Date.now() - 400_000), leaseExpiresAt: new Date(Date.now() - 60_000), processedAt: null },
    });
    await dispatchNotifications(500, "aud10d-worker-c");

    expect((await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("PROCESSED");
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(1);
    expect(await businessState(taskId)).toEqual(committed);
  });
});

describe("duplicate, concurrent and out-of-order delivery (CW-17)", () => {
  it("two workers draining at once deliver each event once", async () => {
    const taskId = await newTask();
    await tasks.completeTask(pm, taskId, await version(taskId));
    const [a, b] = await Promise.all([dispatchNotifications(500, "aud10d-worker-x"), dispatchNotifications(500, "aud10d-worker-y")]);
    expect(a.processed + b.processed).toBeGreaterThanOrEqual(2);
    expect(await notifications(taskId, "TASK_ASSIGNED")).toHaveLength(1);
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(1);
    for (const event of await prisma.notificationEventOutbox.findMany({ where: { entityId: taskId } })) expect(event.status).toBe("PROCESSED");
  });

  it("an older event delivered after a newer one leaves the task — the canonical state — as the newer change left it", async () => {
    const taskId = await newTask();
    await drain();
    await tasks.completeTask(pm, taskId, await version(taskId));
    await tasks.reopenTask(pm, taskId, await version(taskId));
    const [completed] = await events(taskId, "TASK_COMPLETED");
    const [reopened] = await events(taskId, "TASK_STATUS_CHANGED");
    expect(completed.createdAt.getTime()).toBeLessThanOrEqual(reopened.createdAt.getTime());
    const latest = await businessState(taskId);
    expect(latest.task).toMatchObject({ status: "TODO", completedAt: null });

    // The completion is held back; the reopen goes first.
    await prisma.notificationEventOutbox.update({ where: { id: completed.id }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });
    await dispatchNotifications(500, "aud10d-worker");
    expect((await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: reopened.id } })).status).toBe("PROCESSED");
    expect((await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: completed.id } })).status).toBe("PENDING");

    await prisma.notificationEventOutbox.update({ where: { id: completed.id }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });
    await dispatchNotifications(500, "aud10d-worker");
    expect((await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: completed.id } })).status).toBe("PROCESSED");

    // Delivery never writes the record: the late completion regressed nothing.
    expect(await businessState(taskId)).toEqual(latest);
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(1);
    expect(await notifications(taskId, "TASK_STATUS_CHANGED")).toHaveLength(1);
  });

  it("a terminally FAILED event is inspectable, and an operator's retry delivers it without redoing the completion", async () => {
    const taskId = await newTask();
    await drain();
    await tasks.completeTask(pm, taskId, await version(taskId));
    const [event] = await events(taskId, "TASK_COMPLETED");
    const committed = await businessState(taskId);

    // A payload this worker cannot read, on its last allowed attempt.
    await prisma.notificationEventOutbox.update({ where: { id: event.id }, data: { schemaVersion: 99, attemptCount: MAX_ATTEMPTS - 1 } });
    await dispatchNotifications(500, "aud10d-worker");

    const failed = await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: event.id } });
    expect(failed).toMatchObject({ status: "FAILED", lastErrorCode: "UNSUPPORTED_PAYLOAD", attemptCount: MAX_ATTEMPTS, lockedBy: null });
    expect(failed.failedAt).not.toBeNull();
    expect(await prisma.jobFailure.count({ where: { sourceType: "notification_event", sourceId: event.id, errorCode: "UNSUPPORTED_PAYLOAD" } })).toBe(1);
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(0);
    // Committed, delivery failed: the completion stands.
    expect(await businessState(taskId)).toEqual(committed);

    // A worker that reads the payload is deployed; the operator sends the event round again.
    await prisma.notificationEventOutbox.update({ where: { id: event.id }, data: { schemaVersion: 1 } });
    const retried = await retryFailedNotificationEvents({ operator: "aud10d-operator", ids: [event.id] });
    expect(retried).toEqual({ count: 1, ids: [event.id] });
    expect(await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "PENDING", attemptCount: 0, manualRetries: 1 });
    // The failure history stays, marked with who retried it.
    expect(await prisma.jobFailure.findFirstOrThrow({ where: { sourceId: event.id, errorCode: "UNSUPPORTED_PAYLOAD" } })).toMatchObject({ retriedBy: "aud10d-operator" });

    await dispatchNotifications(500, "aud10d-worker");
    expect((await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("PROCESSED");
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(1);
    // One completion, one event, one activity: nothing was redone.
    expect(await businessState(taskId)).toEqual(committed);
    expect(await prisma.activity.count({ where: { entityId: taskId, action: "TASK_COMPLETED" } })).toBe(1);
  });
});

describe("access revoked between the commit and the delivery (CW-15)", () => {
  it("a recipient who lost the record hears nothing about it — not in-app, not by mail — while the event settles", async () => {
    const taskId = await newTask();
    // Positive control: while on the project the Engineer is told of the assignment.
    await dispatchNotifications(500, "aud10d-worker");
    expect(await notifications(taskId, "TASK_ASSIGNED")).toHaveLength(1);
    expect(await canReadRecord(engineer, "task", taskId)).toBe(true);

    await tasks.completeTask(pm, taskId, await version(taskId));
    const [event] = await events(taskId, "TASK_COMPLETED");
    expect((event.payloadJson as Record<string, unknown>).assigneeMemberId).toBe(engineer.membershipId);

    // Taken off the project after the commit, before the worker runs.
    await prisma.projectMember.updateMany({ where: { projectId: PROJECT_ID, companyMemberId: engineer.membershipId }, data: { status: "INACTIVE", leftAt: new Date() } });
    const revoked = await loginAsMembership(engineer.membershipId);
    expect(await canReadRecord(revoked, "task", taskId)).toBe(false);

    await dispatchNotifications(500, "aud10d-worker");
    expect((await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("PROCESSED");
    expect(await notifications(taskId, "TASK_COMPLETED")).toHaveLength(0);
    expect(readOutbox().filter((mail) => mail.to === engineerEmail)).toHaveLength(0);
  });
});
