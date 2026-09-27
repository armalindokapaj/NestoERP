import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { listNotifications, openNotification, WITHDRAWN_TITLE } from "@/lib/core/notifications/notification.service";
import { loadRecord } from "@/lib/core/records/record.registry";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, prisma } from "../../helpers";

/**
 * Safe link states (AUD-10 §3, CW-19).
 *
 * A notification is a stored link to a record. Following it re-reads the
 * record, now, as the reader: a record the reader lost, or one that is gone,
 * opens as "unavailable" and the list withholds the stored title — the private
 * name never reaches the reader again, and the row itself (history) stays. An
 * archived record the reader may still read opens normally, read-only by its
 * own page. Positive control first in each case: the same link opens while
 * access holds.
 */

const PROJECT_ID = "aud10d_links_project";
const TITLE = "aud10d private link title";
const created = new Set<string>();
let pm: UserContext;
let engineer: UserContext;

async function assignedTask(): Promise<{ taskId: string; notificationId: string }> {
  const task = await tasks.createTask(pm, createTaskSchema.parse({ title: TITLE, projectId: PROJECT_ID, assigneeMemberId: engineer.membershipId }));
  created.add(task.id);
  await dispatchNotifications(500, "aud10d-links");
  const notification = await prisma.notification.findFirstOrThrow({ where: { entityId: task.id, recipientMemberId: engineer.membershipId, eventType: "TASK_ASSIGNED" }, select: { id: true, title: true } });
  // The stored row names the task: written for a reader who could open it then.
  expect(notification.title).toContain(TITLE);
  return { taskId: task.id, notificationId: notification.id };
}

async function listed(notificationId: string) {
  const page = await listNotifications(await loginAsMembership(engineer.membershipId), { limit: 100 });
  return page.data.find((row) => row.id === notificationId);
}

async function setOnProject(active: boolean) {
  await prisma.projectMember.updateMany({ where: { projectId: PROJECT_ID, companyMemberId: engineer.membershipId }, data: { status: active ? "ACTIVE" : "INACTIVE", leftAt: active ? null : new Date() } });
}

beforeAll(async () => {
  pm = await loginAs("PROJECT_MANAGER");
  const login = await loginAs("ENGINEER");
  const membership = await prisma.companyMember.findFirstOrThrow({ where: { userId: login.userId, companyId: COMPANY.a, status: "ACTIVE" }, select: { id: true } });
  engineer = await loginAsMembership(membership.id);
  await prisma.project.create({ data: { id: PROJECT_ID, companyId: COMPANY.a, code: "AUD10D-LNK", name: "aud10d links", status: "ACTIVE", projectManagerMemberId: pm.membershipId, createdBy: "test" } });
  await prisma.projectMember.create({ data: { companyId: COMPANY.a, projectId: PROJECT_ID, companyMemberId: engineer.membershipId, status: "ACTIVE" } });
});

beforeEach(async () => {
  await setOnProject(true);
});

afterAll(async () => {
  const ids = [...created];
  const outbox = await prisma.notificationEventOutbox.findMany({ where: { entityId: { in: ids } }, select: { id: true } });
  await prisma.jobFailure.deleteMany({ where: { sourceId: { in: outbox.map((row) => row.id) } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: ids } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { OR: [{ entityId: { in: [...ids, PROJECT_ID] } }, { metadata: { path: ["projectId"], equals: PROJECT_ID } }] } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
  await prisma.projectMember.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("a link whose record the reader lost (CW-19)", () => {
  it("opens while access holds, then as unavailable — and the list withholds the name", async () => {
    const { taskId, notificationId } = await assignedTask();
    expect(await openNotification(engineer, notificationId)).toEqual({ href: `/tasks/${taskId}` });

    await setOnProject(false);
    const reader = await loginAsMembership(engineer.membershipId);
    expect(await loadRecord(reader, "task", taskId)).toBeNull();

    const opened = await openNotification(reader, notificationId);
    expect(opened).toEqual({ unavailable: true });
    const row = await listed(notificationId);
    expect(row).toMatchObject({ title: WITHDRAWN_TITLE, body: null, href: null });
    expect(JSON.stringify(row)).not.toContain(TITLE);
    // History is withheld, not deleted.
    expect(await prisma.notification.count({ where: { id: notificationId } })).toBe(1);

    // Access back, name back: the row was never rewritten.
    await setOnProject(true);
    expect((await listed(notificationId))?.title).toContain(TITLE);
  });
});

describe("a link whose record is gone (CW-19)", () => {
  it("opens as unavailable, without the name", async () => {
    const { taskId, notificationId } = await assignedTask();
    await prisma.meetingActionItem.updateMany({ where: { linkedTaskId: taskId }, data: { linkedTaskId: null } });
    await prisma.task.delete({ where: { id: taskId } });

    expect(await openNotification(engineer, notificationId)).toEqual({ unavailable: true });
    const row = await listed(notificationId);
    expect(row).toMatchObject({ title: WITHDRAWN_TITLE, href: null });
    expect(JSON.stringify(row)).not.toContain(TITLE);
  });
});

describe("a link whose record was archived (CW-19)", () => {
  it("still opens for a reader who may read it — archive is not deletion", async () => {
    const { taskId, notificationId } = await assignedTask();
    await tasks.archiveTask(pm, taskId, { expectedVersion: (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).version });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("ARCHIVED");

    expect(await openNotification(engineer, notificationId)).toEqual({ href: `/tasks/${taskId}` });
    expect((await listed(notificationId))?.title).toContain(TITLE);
  });
});

describe("somebody else's link", () => {
  it("is not found, not unavailable — its existence is not confirmed", async () => {
    const { notificationId } = await assignedTask();
    const error = await openNotification(pm, notificationId).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(AccessError);
    expect((error as AccessError).code).toBe("NOT_FOUND");
  });
});
