import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerDevice } from "@/lib/auth/device.service";
import * as collaboration from "@/lib/core/collaboration/collaboration.service";
import { createCommentSchema } from "@/lib/core/collaboration/collaboration.schema";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { setPushProvidersForTests, type PushProvider } from "@/lib/core/notifications/push.provider";
import { hazardSchema } from "@/lib/modules/hse/hse.schema";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, loginAs, prisma, PROJECT } from "../../helpers";

/**
 * MOB-10 §61, §72, §171, §175: what real domain actions produce, end to end.
 * Providers are fakes; nothing leaves the machine.
 */
const fake: PushProvider = { name: "fake", async send() { return { kind: "accepted", providerMessageId: null }; } };
const createdTasks: string[] = [];
const hazardIds: string[] = [];
const tokens: string[] = [];
const quietUsers: string[] = [];
let counter = 0;
const newToken = () => {
  const token = `test-push-events-${Date.now()}-${(counter += 1)}-abcdefghijklmnop`;
  tokens.push(token);
  return token;
};

beforeEach(() => setPushProvidersForTests({ ios: fake, android: fake }));

afterEach(async () => {
  setPushProvidersForTests(null);
  const entityIds = [...createdTasks, ...hazardIds];
  await prisma.pushDelivery.deleteMany({ where: { notification: { entityId: { in: entityIds } } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: entityIds } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: entityIds } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: createdTasks } }, select: { id: true } });
  const threadIds = threads.map((row) => row.id);
  const comments = await prisma.comment.findMany({ where: { threadId: { in: threadIds } }, select: { id: true } });
  const commentIds = comments.map((row) => row.id);
  await prisma.mention.deleteMany({ where: { commentId: { in: commentIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: commentIds } } });
  await prisma.comment.deleteMany({ where: { id: { in: commentIds } } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threadIds } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threadIds } } });
  await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
  await prisma.hseAction.deleteMany({ where: { hazardId: { in: hazardIds } } });
  await prisma.stopWorkRecord.deleteMany({ where: { hazardId: { in: hazardIds } } });
  await prisma.hseHazard.deleteMany({ where: { id: { in: hazardIds } } });
  await prisma.deviceRegistration.deleteMany({ where: { pushToken: { in: tokens } } });
  await prisma.notificationQuietHours.deleteMany({ where: { userId: { in: quietUsers } } });
  for (const list of [createdTasks, hazardIds, tokens, quietUsers]) list.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("mention and comment (MOB-10 §61, §171)", () => {
  it("gives the mentioned person one notification and one push for one comment", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const architect = await loginAs("ARCHITECT");
    await registerDevice(architect, { platform: "ios", pushToken: newToken(), appVersion: "1.0.0" });
    const task = await tasks.createTask(pm, createTaskSchema.parse({ title: "Facade Revision", projectId: PROJECT.a, assigneeMemberId: engineer.membershipId }));
    createdTasks.push(task.id);
    await dispatchNotifications(500);
    await prisma.pushDelivery.deleteMany({ where: { userId: architect.userId } });

    await collaboration.createComment(pm, "task", task.id, createCommentSchema.parse({ body: `@[x](${architect.membershipId}) please review the latest.` }));
    await dispatchNotifications(500);

    const rows = await prisma.notification.findMany({
      where: { recipientMemberId: architect.membershipId, entityId: task.id, eventType: { in: ["COMMENT_MENTIONED", "COMMENT_ADDED", "COMMENT_REPLY"] } },
    });
    expect(rows.map((row) => row.eventType)).toEqual(["COMMENT_MENTIONED"]);
    const pushes = await prisma.pushDelivery.findMany({ where: { userId: architect.userId } });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].notificationId).toBe(rows[0].id);
  });

  it("a later plain comment reaches a watcher in the inbox only, never the phone", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const architect = await loginAs("ARCHITECT");
    await registerDevice(architect, { platform: "ios", pushToken: newToken(), appVersion: "1.0.0" });
    const task = await tasks.createTask(pm, createTaskSchema.parse({ title: "Facade Revision", projectId: PROJECT.a, assigneeMemberId: engineer.membershipId }));
    createdTasks.push(task.id);
    await collaboration.createComment(pm, "task", task.id, createCommentSchema.parse({ body: `@[x](${architect.membershipId}) look.` }));
    await dispatchNotifications(500);
    await prisma.pushDelivery.deleteMany({ where: { userId: architect.userId } });

    await collaboration.createComment(pm, "task", task.id, createCommentSchema.parse({ body: "Another thought." }));
    await dispatchNotifications(500);

    expect(await prisma.notification.count({ where: { recipientMemberId: architect.membershipId, entityId: task.id, eventType: "COMMENT_ADDED" } })).toBe(1);
    expect(await prisma.pushDelivery.count({ where: { userId: architect.userId } })).toBe(0);
  });
});

describe("critical HSE (MOB-10 §72, §94, §175)", () => {
  it("is pushed at once through quiet hours, unless that person turned the override off", async () => {
    const hse = await loginAs("HSE");
    const pm = await loginAs("PROJECT_MANAGER");
    const window = { enabled: true, startMinute: 0, endMinute: 1439, timezone: "UTC" };
    for (const [person, allowCritical] of [[hse, true], [pm, false]] as const) {
      quietUsers.push(person.userId);
      await registerDevice(person, { platform: "android", pushToken: newToken(), appVersion: "1.0.0" });
      await prisma.notificationQuietHours.create({ data: { userId: person.userId, ...window, allowCritical } });
    }

    const reporter = await loginAs("OWNER");
    const hazard = await hazards.createHazard(
      reporter,
      hazardSchema.parse({
        title: "Unprotected edge",
        description: "Raised by the automated suite.",
        projectId: "project_a",
        hazardCategory: "HOUSEKEEPING",
        likelihood: "4",
        severity: "5",
        immediateControl: "Area barricaded.",
        observedAt: new Date().toISOString().slice(0, 10),
      }),
    );
    hazardIds.push(hazard.id);
    await dispatchNotifications(500);

    const deliveries = await prisma.pushDelivery.findMany({ where: { notification: { entityId: hazard.id, eventType: "HSE_CRITICAL_RISK" } } });
    const byUser = new Map(deliveries.map((row) => [row.userId, row]));
    const now = Date.now();
    expect(byUser.get(hse.userId)?.sendAfter.getTime()).toBeLessThanOrEqual(now + 5000);
    const held = byUser.get(pm.userId);
    expect(held?.sendAfter.getTime()).toBeGreaterThan(now);
    // The in-app notification exists for everybody either way.
    expect(await prisma.notification.count({ where: { entityId: hazard.id, eventType: "HSE_CRITICAL_RISK" } })).toBeGreaterThan(0);
    expect(deliveries.length).toBeGreaterThan(0);
  });
});
