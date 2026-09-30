import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { listPreferences, updatePreference } from "@/lib/core/notifications/notification.preferences";
import { archiveNotificationForWorkspace, getUnreadCount, listNotifications } from "@/lib/core/notifications/notification.service";
import { getQuietHours, listProjectPreferences, quietHoursSchema, setProjectLevel, setQuietHours } from "@/lib/core/notifications/notification.settings";
import * as tasks from "@/lib/modules/tasks/task.service";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import { cleanupSessions, loginAs, prisma, PROJECT } from "../../helpers";

/** MOB-10 §84-§94, §126, §141: settings that follow the person, and the archive. */
const createdTasks: string[] = [];
const quietUsers: string[] = [];

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
  await prisma.notificationQuietHours.deleteMany({ where: { userId: { in: quietUsers } } });
  await prisma.notificationProjectPreference.deleteMany({ where: { projectId: PROJECT.a } });
  createdTasks.length = 0;
  quietUsers.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("quiet hours settings", () => {
  it("stores the person's own window, zone and critical override", async () => {
    const engineer = await loginAs("ENGINEER");
    quietUsers.push(engineer.userId);
    const before = await getQuietHours(engineer);
    expect(before.enabled).toBe(false);

    await setQuietHours(engineer, { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, timezone: "Europe/Tirane", allowCritical: false });
    expect(await getQuietHours(engineer)).toEqual({ enabled: true, startMinute: 1320, endMinute: 420, timezone: "Europe/Tirane", allowCritical: false });
  });

  it("refuses an unknown zone or an out-of-range time", () => {
    const valid = { enabled: true, startMinute: 0, endMinute: 10, timezone: "UTC", allowCritical: true };
    expect(quietHoursSchema.safeParse(valid).success).toBe(true);
    expect(quietHoursSchema.safeParse({ ...valid, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(quietHoursSchema.safeParse({ ...valid, startMinute: 1440 }).success).toBe(false);
  });
});

describe("project preferences", () => {
  it("lists only the member's own projects and refuses a project they are not on", async () => {
    const engineer = await loginAs("ENGINEER");
    const rows = await listProjectPreferences(engineer);
    const own = new Set(rows.map((row) => row.projectId));
    const outsider = await prisma.project.findFirst({ where: { companyId: engineer.companyId, id: { notIn: [...own] } }, select: { id: true } });
    if (outsider) await expect(setProjectLevel(engineer, { projectId: outsider.id, level: "MUTED" })).rejects.toBeInstanceOf(AccessError);
    if (own.size > 0) {
      const projectId = [...own][0];
      const updated = await setProjectLevel(engineer, { projectId, level: "IMPORTANT" });
      expect(updated.level).toBe("IMPORTANT");
      expect((await listProjectPreferences(engineer)).find((row) => row.projectId === projectId)?.level).toBe("IMPORTANT");
      await prisma.notificationProjectPreference.deleteMany({ where: { projectId } });
    }
  });
});

describe("push preference", () => {
  it("defaults on, changes alone, and cannot silence a mandatory category", async () => {
    const engineer = await loginAs("ENGINEER");
    try {
      const defaults = await listPreferences(engineer);
      expect(defaults.every((row) => row.pushEnabled)).toBe(true);

      await updatePreference(engineer, { category: "tasks", inAppEnabled: true, emailEnabled: false, pushEnabled: false });
      // A later change that does not mention push leaves the choice alone.
      await updatePreference(engineer, { category: "tasks", inAppEnabled: true, emailEnabled: false });
      expect((await listPreferences(engineer)).find((row) => row.category === "tasks")?.pushEnabled).toBe(false);

      const hse = await updatePreference(engineer, { category: "hse", inAppEnabled: false, emailEnabled: false, pushEnabled: false });
      expect(hse.inAppEnabled).toBe(true);
      expect(hse.pushEnabled).toBe(true);
    } finally {
      await prisma.notificationPreference.deleteMany({ where: { memberId: engineer.membershipId, category: { in: ["tasks", "hse"] } } });
    }
  });
});

describe("archive", () => {
  it("takes a notification out of the list and the count, and only for its owner", async () => {
    const engineer = await loginAs("ENGINEER");
    const owner = await loginAs("OWNER");
    const task = await tasks.createTask(owner, createTaskSchema.parse({ title: "Archive me", projectId: PROJECT.a, assigneeMemberId: engineer.membershipId }));
    createdTasks.push(task.id);
    await dispatchNotifications();

    const row = await prisma.notification.findFirstOrThrow({ where: { entityId: task.id, recipientMemberId: engineer.membershipId } });
    expect(row.threadKey).toBe(`task:${task.id}`);
    const unreadBefore = (await getUnreadCount(engineer)).unread;

    await expect(archiveNotificationForWorkspace(owner, row.id)).rejects.toBeInstanceOf(AccessError);
    await archiveNotificationForWorkspace(engineer, row.id);

    expect((await listNotifications(engineer)).data.some((item) => item.id === row.id)).toBe(false);
    expect((await getUnreadCount(engineer)).unread).toBe(unreadBefore - 1);
    // The row is kept: archiving is not deletion.
    expect(await prisma.notification.count({ where: { id: row.id } })).toBe(1);
  });
});
