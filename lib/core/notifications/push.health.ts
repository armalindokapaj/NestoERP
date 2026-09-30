import { prisma } from "@/lib/database/prisma";
import { effectivePushMode } from "./push.provider";

/**
 * Notification system health for a platform administrator (MOB-10 §113, §191, §192).
 *
 * Counts and states only. No recipient, no token, no message text, and nothing
 * per person: this is system health, not a view of who read what and how fast.
 */
export type NotificationHealth = {
  windowHours: number;
  mode: "off" | "log" | "live";
  credentials: { apns: boolean; fcm: boolean };
  eventsProcessed: number;
  notificationsCreated: number;
  pushAttempted: number;
  pushAccepted: number;
  pushFailed: number;
  pushSuppressed: number;
  invalidTokens: number;
  outboxBacklog: number;
  outboxFailed: number;
  pushQueueDue: number;
  registeredDevices: { ios: number; android: number };
};

export async function notificationHealth(windowHours = 24, now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<NotificationHealth> {
  const since = new Date(now.getTime() - windowHours * 3_600_000);
  const settledSince = { settledAt: { gte: since } };
  const [processed, created, attempted, accepted, failed, suppressed, invalid, backlog, outboxFailed, due, ios, android] = await Promise.all([
    prisma.notificationEventOutbox.count({ where: { status: "PROCESSED", processedAt: { gte: since } } }),
    prisma.notification.count({ where: { createdAt: { gte: since } } }),
    prisma.pushDelivery.count({ where: { attemptCount: { gt: 0 }, updatedAt: { gte: since } } }),
    prisma.pushDelivery.count({ where: { state: "PROVIDER_ACCEPTED", ...settledSince } }),
    prisma.pushDelivery.count({ where: { state: "FAILED", ...settledSince } }),
    prisma.pushDelivery.count({ where: { state: "SUPPRESSED", ...settledSince } }),
    prisma.pushDelivery.count({ where: { state: "TOKEN_INVALID", ...settledSince } }),
    prisma.notificationEventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.notificationEventOutbox.count({ where: { status: "FAILED" } }),
    prisma.pushDelivery.count({ where: { state: "QUEUED", sendAfter: { lte: now } } }),
    prisma.deviceRegistration.count({ where: { enabled: true, platform: "IOS" } }),
    prisma.deviceRegistration.count({ where: { enabled: true, platform: "ANDROID" } }),
  ]);
  return {
    windowHours,
    mode: effectivePushMode(env),
    // Whether a secret is set, never its value.
    credentials: { apns: Boolean(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY && env.APNS_BUNDLE_ID), fcm: Boolean(env.FCM_SERVICE_ACCOUNT) },
    eventsProcessed: processed,
    notificationsCreated: created,
    pushAttempted: attempted,
    pushAccepted: accepted,
    pushFailed: failed,
    pushSuppressed: suppressed,
    invalidTokens: invalid,
    outboxBacklog: backlog,
    outboxFailed,
    pushQueueDue: due,
    registeredDevices: { ios, android },
  };
}
