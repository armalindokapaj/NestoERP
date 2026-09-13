import { afterAll, afterEach, describe, expect, it } from "vitest";

import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import {
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
} from "@/lib/core/notifications/notification.service";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import * as tasks from "@/lib/modules/tasks/task.service";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import { cleanupSessions, loginAs, prisma, PROJECT } from "../../helpers";

/**
 * Notifications, end to end (PRD #25 §25-§49, §230-§245).
 *
 * The 2026-09-13 gap audit found four models, a 389-line service and three read
 * routes with nothing that ever produced a notification: the bell could only
 * ever be empty. These tests follow the whole chain — a domain action enqueues
 * an event on its own transaction, the dispatcher resolves recipients against
 * live access, and the right person ends up with exactly one row.
 */
const createdTasks: string[] = [];

afterEach(async () => {
  if (createdTasks.length > 0) {
    await prisma.notification.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.notificationEventOutbox.deleteMany({
      where: { entityId: { in: createdTasks } },
    });
    await prisma.activity.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
    createdTasks.length = 0;
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function assignTaskTo(
  assigneeMemberId: string,
  options: { actor?: UserContext; title?: string } = {},
) {
  const actor = options.actor ?? (await loginAs("OWNER"));
  const task = await tasks.createTask(
    actor,
    createTaskSchema.parse({
      title: options.title ?? "Notification test task",
      projectId: PROJECT.a,
      assigneeMemberId,
    }),
  );
  createdTasks.push(task.id);
  return { actor, task };
}

describe("producing and dispatching (PRD #25 §25, §30)", () => {
  it("turns an assignment into one notification for the assignee", async () => {
    const engineer = await loginAs("ENGINEER");
    const { task } = await assignTaskTo(engineer.membershipId);

    // The event is enqueued on the caller's transaction, not delivered inline.
    const queued = await prisma.notificationEventOutbox.findFirst({
      where: { entityId: task.id, eventType: NotificationEvent.TASK_ASSIGNED },
    });
    expect(queued).not.toBeNull();
    expect(queued!.status).toBe("PENDING");

    await dispatchNotifications();

    const rows = await prisma.notification.findMany({ where: { entityId: task.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientMemberId).toBe(engineer.membershipId);
    expect(rows[0].readState).toBe("UNREAD");
    expect(rows[0].title).toContain("Notification test task");

    const settled = await prisma.notificationEventOutbox.findUnique({ where: { id: queued!.id } });
    expect(settled!.status).toBe("PROCESSED");
  });

  /**
   * The dedupe key is what makes outbox retries safe. Dispatching the same
   * event twice must not produce a second row (PRD #25 §230).
   */
  it("is idempotent when the same event is dispatched again", async () => {
    const engineer = await loginAs("ENGINEER");
    const { task } = await assignTaskTo(engineer.membershipId);

    await dispatchNotifications();

    // Put the event back in the queue, as a retry after a partial failure would.
    await prisma.notificationEventOutbox.updateMany({
      where: { entityId: task.id },
      data: { status: "PENDING", processedAt: null },
    });
    await dispatchNotifications();

    const rows = await prisma.notification.findMany({ where: { entityId: task.id } });
    expect(rows).toHaveLength(1);
  });

  /** Nobody needs telling about their own action (PRD #25 §39). */
  it("does not notify the actor about their own assignment", async () => {
    // The project manager, because assigning project work needs the assignee
    // to be on the project — self-assignment by an outsider is refused before
    // notifications ever come into it.
    const pm = await loginAs("PROJECT_MANAGER");
    const { task } = await assignTaskTo(pm.membershipId, { actor: pm });

    await dispatchNotifications();

    const rows = await prisma.notification.findMany({ where: { entityId: task.id } });
    expect(rows).toHaveLength(0);
  });
});

describe("entitlement is decided at delivery (PRD #25 §37, §42, §49)", () => {
  /**
   * The window this closes: an event is produced, and by the time it is
   * delivered the recipient's access is gone. Delivery must re-check, not
   * trust the moment of production.
   */
  it("drops a recipient whose membership was suspended after the event", async () => {
    const owner = await loginAs("OWNER");
    const engineer = await loginAs("ENGINEER");
    const { task } = await assignTaskTo(engineer.membershipId);

    await prisma.companyMember.update({
      where: { id: engineer.membershipId },
      data: { status: "SUSPENDED" },
    });

    try {
      await dispatchNotifications();

      const rows = await prisma.notification.findMany({ where: { entityId: task.id } });
      expect(rows).toHaveLength(0);
    } finally {
      await prisma.companyMember.update({
        where: { id: engineer.membershipId },
        data: { status: "ACTIVE" },
      });
      void owner;
    }
  });
});

describe("the read side (PRD #25 §157, §165)", () => {
  it("counts, marks one read, and marks the rest read", async () => {
    const engineer = await loginAs("ENGINEER");
    const { task } = await assignTaskTo(engineer.membershipId);
    await dispatchNotifications();

    const before = await getUnreadCount(engineer);
    expect(before.unread).toBeGreaterThan(0);

    const { data } = await listNotifications(engineer, { readState: "UNREAD" });
    const mine = data.find((row) => row.entity?.entityId === task.id);
    expect(mine).toBeDefined();

    await markRead(engineer, mine!.id, true);
    const afterOne = await getUnreadCount(engineer);
    expect(afterOne.unread).toBe(before.unread - 1);

    await markAllRead(engineer);
    expect((await getUnreadCount(engineer)).unread).toBe(0);
  });

  it("will not let somebody mark another member's notification read", async () => {
    const engineer = await loginAs("ENGINEER");
    const architect = await loginAs("ARCHITECT");
    const { task } = await assignTaskTo(engineer.membershipId);
    await dispatchNotifications();

    const row = await prisma.notification.findFirst({ where: { entityId: task.id } });
    expect(row).not.toBeNull();

    // Not found rather than forbidden: the endpoint must not confirm that
    // somebody else's notification exists.
    await expect(markRead(architect, row!.id, true)).rejects.toBeInstanceOf(AccessError);
  });
});
