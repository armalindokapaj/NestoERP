import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerDevice } from "@/lib/auth/device.service";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { updatePreference } from "@/lib/core/notifications/notification.preferences";
import { setPushProvidersForTests, type PushMessage, type PushOutcome, type PushProvider } from "@/lib/core/notifications/push.provider";
import { badgeCountForUser, sendDuePushDeliveries } from "@/lib/core/notifications/push.service";
import type { UserContext } from "@/lib/context/types";
import * as tasks from "@/lib/modules/tasks/task.service";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import { cleanupSessions, loginAs, prisma, PROJECT } from "../../helpers";

/**
 * Push delivery, end to end (MOB-10 §110-§116, §169, §178-§183).
 *
 * A real assignment produces the in-app notification through the real outbox;
 * the provider is a recording fake, so nothing leaves the machine. The point is
 * the rules around the send: what is queued, what is re-checked at send time,
 * and what a provider's answer does.
 */
const createdTasks: string[] = [];
const tokens: string[] = [];
const users: string[] = [];
let outcome: PushOutcome = { kind: "accepted", providerMessageId: "m1" };
let sent: Array<{ token: string; message: PushMessage }> = [];

const fake: PushProvider = {
  name: "fake",
  async send(token, message) {
    sent.push({ token, message });
    return outcome;
  },
};

beforeEach(() => {
  outcome = { kind: "accepted", providerMessageId: "m1" };
  sent = [];
  setPushProvidersForTests({ ios: fake, android: fake });
});

afterEach(async () => {
  setPushProvidersForTests(null);
  await prisma.pushDelivery.deleteMany({ where: { notification: { entityId: { in: createdTasks } } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
  await prisma.deviceRegistration.deleteMany({ where: { pushToken: { in: tokens } } });
  await prisma.notificationQuietHours.deleteMany({ where: { userId: { in: users } } });
  createdTasks.length = 0;
  tokens.length = 0;
  users.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

let counter = 0;
const newToken = () => {
  const token = `test-push-token-${Date.now()}-${(counter += 1)}-abcdefghijkl`;
  tokens.push(token);
  return token;
};

async function assign(to: UserContext): Promise<string> {
  const actor = await loginAs("OWNER");
  const task = await tasks.createTask(actor, createTaskSchema.parse({ title: "Facade Inspection", projectId: PROJECT.a, assigneeMemberId: to.membershipId }));
  createdTasks.push(task.id);
  await dispatchNotifications();
  const row = await prisma.notification.findFirstOrThrow({ where: { entityId: task.id, recipientMemberId: to.membershipId } });
  return row.id;
}

async function engineerWithDevice(platform: "ios" | "android" = "ios") {
  const engineer = await loginAs("ENGINEER");
  users.push(engineer.userId);
  const token = newToken();
  const { id } = await registerDevice(engineer, { platform, pushToken: token, appVersion: "1.0.0" });
  return { engineer, token, deviceId: id };
}

describe("queueing (MOB-10 §110, §143)", () => {
  it("queues one delivery per enabled device and sends an id-only payload", async () => {
    const { engineer, token } = await engineerWithDevice();
    const notificationId = await assign(engineer);

    const rows = await prisma.pushDelivery.findMany({ where: { notificationId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("QUEUED");

    const result = await sendDuePushDeliveries(50, "test");
    expect(result.accepted).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe(token);
    expect(sent[0].message.path).toBe(`/notifications/${notificationId}/open`);
    expect(sent[0].message.badge).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(sent[0].message)).not.toMatch(/cookie|session|password/i);
    expect((await prisma.pushDelivery.findUniqueOrThrow({ where: { id: rows[0].id } })).state).toBe("PROVIDER_ACCEPTED");
  });

  it("does not queue a second delivery when the event is dispatched again", async () => {
    const { engineer } = await engineerWithDevice();
    const notificationId = await assign(engineer);
    await prisma.notificationEventOutbox.updateMany({ where: { entityId: { in: createdTasks } }, data: { status: "PENDING", processedAt: null } });
    await dispatchNotifications();
    expect(await prisma.pushDelivery.count({ where: { notificationId } })).toBe(1);
  });

  it("queues nothing for a person with no device, and nothing when the category push switch is off", async () => {
    const engineer = await loginAs("ENGINEER");
    const withoutDevice = await assign(engineer);
    expect(await prisma.pushDelivery.count({ where: { notificationId: withoutDevice } })).toBe(0);

    await registerDevice(engineer, { platform: "ios", pushToken: newToken(), appVersion: "1.0.0" });
    await updatePreference(engineer, { category: "tasks", inAppEnabled: true, emailEnabled: false, pushEnabled: false });
    try {
      const switchedOff = await assign(engineer);
      // The in-app notification still exists; only the phone is silent.
      expect(await prisma.notification.count({ where: { id: switchedOff } })).toBe(1);
      expect(await prisma.pushDelivery.count({ where: { notificationId: switchedOff } })).toBe(0);
    } finally {
      await prisma.notificationPreference.deleteMany({ where: { memberId: engineer.membershipId, category: "tasks" } });
    }
  });

  it("holds ordinary push until quiet hours end, while the notification exists at once", async () => {
    const { engineer } = await engineerWithDevice();
    await prisma.notificationQuietHours.create({ data: { userId: engineer.userId, enabled: true, startMinute: 0, endMinute: 1439, timezone: "UTC" } });
    const notificationId = await assign(engineer);

    const row = await prisma.pushDelivery.findFirstOrThrow({ where: { notificationId } });
    expect(row.sendAfter.getTime()).toBeGreaterThan(Date.now());
    expect((await sendDuePushDeliveries(50, "test")).claimed).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("send-time re-check (MOB-10 §37, §38, §179, §180)", () => {
  it("does not send once the device's session has ended", async () => {
    const { engineer } = await engineerWithDevice();
    const notificationId = await assign(engineer);
    await prisma.session.update({ where: { id: engineer.sessionId! }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await sendDuePushDeliveries(50, "test");
    expect(result.suppressed).toBe(1);
    expect(sent).toHaveLength(0);
    expect((await prisma.pushDelivery.findFirstOrThrow({ where: { notificationId } })).lastErrorCode).toBe("DEVICE_GONE");
  });

  it("keeps the delivery as history, unsent, when the user signs out", async () => {
    const { engineer } = await engineerWithDevice();
    const notificationId = await assign(engineer);
    // Sign-out deletes the session; the device stays (MOB-11), but nothing is sent to an install with no session.
    await prisma.session.delete({ where: { id: engineer.sessionId! } });

    expect((await sendDuePushDeliveries(50, "test")).suppressed).toBe(1);
    expect(sent).toHaveLength(0);
    const row = await prisma.pushDelivery.findFirstOrThrow({ where: { notificationId } });
    expect(row.state).toBe("SUPPRESSED");
  });

  it("does not deliver the previous person's notification after the device changes hands", async () => {
    const { engineer, token } = await engineerWithDevice();
    const notificationId = await assign(engineer);
    const other = await loginAs("PROJECT_MANAGER");
    users.push(other.userId);
    await registerDevice(other, { platform: "ios", pushToken: token, appVersion: "1.0.0" });

    const result = await sendDuePushDeliveries(50, "test");
    expect(result.suppressed).toBe(1);
    expect(sent).toHaveLength(0);
    expect((await prisma.pushDelivery.findFirstOrThrow({ where: { notificationId } })).state).toBe("SUPPRESSED");
  });

  it("does not push a notification that was read in the meantime", async () => {
    const { engineer } = await engineerWithDevice();
    const notificationId = await assign(engineer);
    await prisma.notification.update({ where: { id: notificationId }, data: { readState: "READ", readAt: new Date() } });

    expect((await sendDuePushDeliveries(50, "test")).suppressed).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("badge is the canonical unread count for the person", async () => {
    const { engineer } = await engineerWithDevice();
    const before = await badgeCountForUser(engineer.userId);
    await assign(engineer);
    expect(await badgeCountForUser(engineer.userId)).toBe(before + 1);
  });
});

describe("provider answers (MOB-10 §111, §114, §116, §183)", () => {
  it("a provider outage retries later and never touches the notification", async () => {
    const { engineer } = await engineerWithDevice();
    const notificationId = await assign(engineer);
    outcome = { kind: "transient", code: "APNS_ServiceUnavailable" };

    const result = await sendDuePushDeliveries(50, "test");
    expect(result.retried).toBe(1);
    const row = await prisma.pushDelivery.findFirstOrThrow({ where: { notificationId } });
    expect(row.state).toBe("QUEUED");
    expect(row.attemptCount).toBe(1);
    expect(row.sendAfter.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.notification.count({ where: { id: notificationId, readState: "UNREAD" } })).toBe(1);
  });

  it("gives up after the retry budget and records FAILED", async () => {
    const { engineer } = await engineerWithDevice();
    const notificationId = await assign(engineer);
    outcome = { kind: "transient", code: "APNS_ServiceUnavailable" };
    const row = await prisma.pushDelivery.findFirstOrThrow({ where: { notificationId } });
    await prisma.pushDelivery.update({ where: { id: row.id }, data: { attemptCount: 4 } });

    expect((await sendDuePushDeliveries(50, "test")).failed).toBe(1);
    expect((await prisma.pushDelivery.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("FAILED");
  });

  it("an invalid token switches the device off and is never retried", async () => {
    const { engineer, deviceId } = await engineerWithDevice();
    const notificationId = await assign(engineer);
    outcome = { kind: "invalid-token", code: "APNS_Unregistered" };

    expect((await sendDuePushDeliveries(50, "test")).invalidTokens).toBe(1);
    expect((await prisma.pushDelivery.findFirstOrThrow({ where: { notificationId } })).state).toBe("TOKEN_INVALID");
    expect((await prisma.deviceRegistration.findUniqueOrThrow({ where: { id: deviceId } })).enabled).toBe(false);
    expect((await sendDuePushDeliveries(50, "test")).claimed).toBe(0);
  });

  it("two devices of one person each get the push, and read state is shared", async () => {
    const { engineer } = await engineerWithDevice("ios");
    await registerDevice(engineer, { platform: "android", pushToken: newToken(), appVersion: "1.0.0" });
    const notificationId = await assign(engineer);

    expect((await sendDuePushDeliveries(50, "test")).accepted).toBe(2);
    expect(new Set(sent.map((entry) => entry.message.notificationId))).toEqual(new Set([notificationId]));
  });

  it("two workers never send the same delivery", async () => {
    const { engineer } = await engineerWithDevice();
    await assign(engineer);
    const [a, b] = await Promise.all([sendDuePushDeliveries(50, "w1"), sendDuePushDeliveries(50, "w2")]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(sent).toHaveLength(1);
  });
});
