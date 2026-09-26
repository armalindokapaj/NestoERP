import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { dismissAttention, listReadableAttention } from "@/lib/core/notifications/attention.service";
import { claimOutboxBatch, dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { listPreferences, updatePreference } from "@/lib/core/notifications/notification.preferences";
import { enqueueNotificationEvent, openNotification } from "@/lib/core/notifications/notification.service";
import { openApproval } from "@/lib/modules/procurement/approvals/approval.service";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, loginAs, prisma, PROJECT, taskVersion } from "../../helpers";

/**
 * Attention, deep links, preferences and worker leases (PRD #38 §77-§85, §96).
 */

const DAY = 86_400_000;
const createdTasks: string[] = [];
const createdNotifications: string[] = [];

afterEach(async () => {
  if (createdTasks.length > 0) {
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.notification.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.subscription.deleteMany({ where: { thread: { parentId: { in: createdTasks } } } });
    await prisma.collaborationThread.deleteMany({ where: { parentId: { in: createdTasks } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
    createdTasks.length = 0;
  }
  if (createdNotifications.length > 0) {
    await prisma.notification.deleteMany({ where: { id: { in: createdNotifications } } });
    createdNotifications.length = 0;
  }
  await prisma.notificationPreference.deleteMany({ where: { memberId: "member_engineer", category: { in: ["tasks", "hse"] } } });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function overdueTaskFor(assigneeRole: "ENGINEER" | "PROJECT_MANAGER", daysOverdue = 3) {
  const owner = await loginAs("OWNER");
  const assignee = await loginAs(assigneeRole);
  const task = await tasks.createTask(
    owner,
    createTaskSchema.parse({ title: `Attention test ${Math.random().toString(36).slice(2, 8)}`, projectId: PROJECT.a, assigneeMemberId: assignee.membershipId }),
  );
  createdTasks.push(task.id);
  const dueDate = new Date(Date.now() - daysOverdue * DAY);
  await prisma.task.update({ where: { id: task.id }, data: { dueDate } });
  return { owner, assignee, task, dueDate };
}

const itemsFor = (taskId: string) =>
  prisma.attentionItem.findMany({ where: { entityType: "task", entityId: taskId }, orderBy: { createdAt: "asc" } });

describe("attention reconciliation (PRD #38 §83-§85)", () => {
  it("raises an overdue task for its assignee, and only for people who can open it", async () => {
    const { assignee, task, owner } = await overdueTaskFor("ENGINEER");
    await reconcileAttention({ companyId: owner.companyId });

    const items = await itemsFor(task.id);
    expect(items.map((item) => item.recipientMemberId)).toEqual([assignee.membershipId]);
    expect(items[0].conditionKey).toBe("OVERDUE_TASK");
    expect(items[0].status).toBe("ACTIVE");

    const readable = await listReadableAttention(assignee, 100);
    const shown = readable.find((item) => item.entity.entityId === task.id);
    expect(shown?.href).toBe(`/tasks/${task.id}`);

    const viewer = await loginAs("VIEWER");
    expect((await listReadableAttention(viewer, 100)).some((item) => item.entity.entityId === task.id)).toBe(false);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { task, owner } = await overdueTaskFor("ENGINEER");
    await reconcileAttention({ companyId: owner.companyId });
    const first = await itemsFor(task.id);
    await reconcileAttention({ companyId: owner.companyId });
    const second = await itemsFor(task.id);
    expect(second.map((item) => [item.id, item.status])).toEqual(first.map((item) => [item.id, item.status]));
  });

  it("resolves when the task is completed", async () => {
    const { assignee, task, owner } = await overdueTaskFor("ENGINEER");
    await reconcileAttention({ companyId: owner.companyId });

    await tasks.completeTask(assignee, task.id, await taskVersion(task.id));
    expect((await itemsFor(task.id)).every((item) => item.status === "RESOLVED")).toBe(true);

    // And the next run does not bring it back.
    await reconcileAttention({ companyId: owner.companyId });
    expect((await itemsFor(task.id)).every((item) => item.status === "RESOLVED")).toBe(true);
  });

  it("stops showing an item the moment its condition ends, before the scheduler runs", async () => {
    const { assignee, task, owner } = await overdueTaskFor("ENGINEER");
    await reconcileAttention({ companyId: owner.companyId });

    // Changed behind the services' back: only the condition check can notice.
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date(Date.now() + 5 * DAY) } });

    const readable = await listReadableAttention(assignee, 100);
    expect(readable.some((item) => item.entity.entityId === task.id)).toBe(false);
    expect((await itemsFor(task.id))[0].status).toBe("RESOLVED");
  });

  it("follows a reassignment: the old assignee's item resolves, the new one's appears", async () => {
    const { assignee, task, owner } = await overdueTaskFor("ENGINEER");
    await reconcileAttention({ companyId: owner.companyId });

    const pm = await loginAs("PROJECT_MANAGER");
    await prisma.task.update({ where: { id: task.id }, data: { assigneeMemberId: pm.membershipId } });
    await reconcileAttention({ companyId: owner.companyId });

    const items = await itemsFor(task.id);
    expect(items.find((item) => item.recipientMemberId === assignee.membershipId)?.status).toBe("RESOLVED");
    expect(items.find((item) => item.recipientMemberId === pm.membershipId)?.status).toBe("ACTIVE");
  });

  it("keeps a dismissed item dismissed, and raises the next episode afresh", async () => {
    const { assignee, task, owner } = await overdueTaskFor("ENGINEER");
    await reconcileAttention({ companyId: owner.companyId });
    const [item] = await itemsFor(task.id);

    await dismissAttention(assignee, item.id);
    await reconcileAttention({ companyId: owner.companyId });
    expect((await prisma.attentionItem.findUnique({ where: { id: item.id } }))!.status).toBe("DISMISSED");

    // A new due date that is also missed is a new episode.
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date(Date.now() - 1.5 * DAY) } });
    await reconcileAttention({ companyId: owner.companyId });
    const active = (await itemsFor(task.id)).filter((row) => row.status === "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(item.id);
  });

  it("lets nobody dismiss another member's item", async () => {
    const { task, owner } = await overdueTaskFor("ENGINEER");
    await reconcileAttention({ companyId: owner.companyId });
    const [item] = await itemsFor(task.id);

    const pm = await loginAs("PROJECT_MANAGER");
    await expect(dismissAttention(pm, item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("notification deep links re-authorise (PRD #38 §82)", () => {
  async function notificationFor(memberId: string, companyId: string, entityType: string, entityId: string) {
    const row = await prisma.notification.create({
      data: {
        companyId,
        recipientMemberId: memberId,
        eventType: NotificationEvent.TASK_ASSIGNED,
        category: "tasks",
        moduleKey: "tasks",
        title: "Test notification",
        priority: "NORMAL",
        entityType,
        entityId,
        dedupeKey: `test:${Math.random()}`,
      },
    });
    createdNotifications.push(row.id);
    return row;
  }

  it("opens the record for its recipient and marks the notification read", async () => {
    const { assignee, task } = await overdueTaskFor("ENGINEER");
    const row = await notificationFor(assignee.membershipId, assignee.companyId, "task", task.id);

    expect(await openNotification(assignee, row.id)).toEqual({ href: `/tasks/${task.id}` });
    expect((await prisma.notification.findUnique({ where: { id: row.id } }))!.readState).toBe("READ");
  });

  it("answers not found for someone else's notification", async () => {
    const { assignee, task } = await overdueTaskFor("ENGINEER");
    const row = await notificationFor(assignee.membershipId, assignee.companyId, "task", task.id);

    const viewer = await loginAs("VIEWER");
    await expect(openNotification(viewer, row.id)).rejects.toBeInstanceOf(AccessError);
  });

  it("says unavailable — and nothing more — once access to the record is gone", async () => {
    // A record this member cannot read: another person's HR file.
    const viewer = await loginAs("VIEWER");
    const ownerEmployment = await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: "member_owner" }, select: { id: true } });
    const hrRecord = await notificationFor(viewer.membershipId, viewer.companyId, "employee", ownerEmployment.id);
    expect(await openNotification(viewer, hrRecord.id)).toEqual({ unavailable: true });

    // A record that no longer exists answers exactly the same way.
    const { assignee, task } = await overdueTaskFor("ENGINEER");
    const row = await notificationFor(assignee.membershipId, assignee.companyId, "task", task.id);
    await prisma.subscription.deleteMany({ where: { thread: { parentId: task.id } } });
    await prisma.collaborationThread.deleteMany({ where: { parentId: task.id } });
    await prisma.activity.deleteMany({ where: { entityId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
    expect(await openNotification(assignee, row.id)).toEqual({ unavailable: true });
  });
});

describe("preferences (PRD #38 §78)", () => {
  it("suppresses an in-app category the member switched off", async () => {
    const engineer = await loginAs("ENGINEER");
    await updatePreference(engineer, { category: "tasks", inAppEnabled: false, emailEnabled: false });

    const { task } = await overdueTaskFor("ENGINEER");
    await dispatchNotifications();
    expect(await prisma.notification.count({ where: { entityId: task.id, recipientMemberId: engineer.membershipId } })).toBe(0);
  });

  it("will not let critical safety alerts be switched off in-app", async () => {
    const engineer = await loginAs("ENGINEER");
    const saved = await updatePreference(engineer, { category: "hse", inAppEnabled: false, emailEnabled: false });
    expect(saved.inAppEnabled).toBe(true);
    expect(saved.inAppLocked).toBe(true);
    const hse = (await listPreferences(engineer)).find((row) => row.category === "hse");
    expect(hse?.inAppEnabled).toBe(true);
  });
});

describe("worker concurrency (PRD #38 §80, §96)", () => {
  it("never hands one outbox event to two workers", async () => {
    const { task, owner } = await overdueTaskFor("ENGINEER");
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 6; i += 1) {
        await enqueueNotificationEvent(tx, {
          companyId: owner.companyId,
          eventType: NotificationEvent.TASK_STATUS_CHANGED,
          moduleKey: "tasks",
          entityType: "task",
          entityId: task.id,
          payload: { title: "lease test", status: "IN_PROGRESS" },
        });
      }
    });

    const [a, b] = await Promise.all([claimOutboxBatch(500, "worker-a"), claimOutboxBatch(500, "worker-b")]);
    const ours = (rows: { entityId: string; id: string }[]) => rows.filter((row) => row.entityId === task.id).map((row) => row.id);
    const overlap = ours(a).filter((id) => ours(b).includes(id));
    expect(overlap).toEqual([]);
    expect(ours(a).length + ours(b).length).toBeGreaterThanOrEqual(6);

    // Release the claims so later dispatches in this run are not held up.
    await prisma.notificationEventOutbox.updateMany({
      where: { entityId: task.id },
      data: { status: "PENDING", attemptCount: 0, lockedAt: null, lockedBy: null, leaseExpiresAt: null },
    });
  });
});

describe("approval producers (PRD #38 §74)", () => {
  it("announces a purchase order for approval with the permission deciding it takes", async () => {
    const procurement = await loginAs("PROCUREMENT");
    const recordId = `po_test_${Date.now()}`;
    const rollback = new Error("rollback");

    await expect(
      prisma.$transaction(async (tx) => {
        await openApproval(tx, procurement, "PURCHASE_ORDER", recordId);
        const queued = await tx.notificationEventOutbox.findFirst({ where: { entityId: recordId } });
        expect(queued?.eventType).toBe(NotificationEvent.PO_APPROVAL_REQUIRED);
        expect(queued?.entityType).toBe("purchase_order");
        expect((queued?.payloadJson as { approvePermissions?: string[] }).approvePermissions).toEqual(["procurement.order.approve"]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
