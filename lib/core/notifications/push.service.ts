import { pushableDevice, pushableDevices, disableDevice } from "@/lib/auth/device.service";
import { DB_NOW } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import type { NotificationPriority } from "./notification.events";
import { androidChannel, decidePush, type ProjectLevel } from "./push.policy";
import { renderPushText } from "./push.privacy";
import { pushEnabledFor, pushProviderFor, type PushMessage } from "./push.provider";
import { quietHoursEnd, type QuietHours } from "./push.quiet-hours";

/**
 * Push delivery (MOB-10 §110-§116).
 *
 * Two halves, deliberately apart:
 *
 *   queuePush   runs inside the outbox dispatcher after the in-app notification
 *               exists. It decides, per recipient and device, whether a push is
 *               wanted, and writes `PushDelivery` rows. No network.
 *   sendDue     a separate drain that claims due rows, re-checks the device and
 *               the notification, sends through the provider and records what
 *               the provider said. A provider outage only delays or fails rows;
 *               the notification and the business action are untouched.
 */

export const PUSH_MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 120;
const BACKOFF_SECONDS = [30, 120, 480, 1920];

export function pushRetryDelaySeconds(attempt: number, random: () => number = Math.random): number {
  const base = BACKOFF_SECONDS[Math.min(Math.max(attempt, 1), BACKOFF_SECONDS.length) - 1];
  return Math.max(1, Math.round(base * (0.8 + 0.4 * random())));
}

export type QueuedNotification = {
  notificationId: string;
  companyId: string;
  userId: string;
  memberId: string;
  eventType: string;
  category: string | null;
  priority: NotificationPriority;
  projectId: string | null;
  mandatory: boolean;
  categoryPushEnabled: boolean;
};

const defaultQuietHours = (): QuietHours => ({ enabled: false, startMinute: 1320, endMinute: 420, timezone: "UTC", allowCritical: true });

/** Writes the delivery rows for notifications just created. Returns how many rows were queued. */
export async function queuePush(entries: QueuedNotification[], now: Date = new Date()): Promise<number> {
  if (entries.length === 0 || !(await pushEnabledFor())) return 0;

  const projectIds = [...new Set(entries.map((entry) => entry.projectId).filter((id): id is string => Boolean(id)))];
  const memberIds = [...new Set(entries.map((entry) => entry.memberId))];
  const userIds = [...new Set(entries.map((entry) => entry.userId))];

  const [levels, quiet, devices] = await Promise.all([
    projectIds.length
      ? prisma.notificationProjectPreference.findMany({
          where: { companyId: entries[0].companyId, memberId: { in: memberIds }, projectId: { in: projectIds } },
          select: { memberId: true, projectId: true, level: true },
        })
      : Promise.resolve([]),
    prisma.notificationQuietHours.findMany({ where: { userId: { in: userIds } } }),
    pushableDevices(userIds),
  ]);
  const levelOf = new Map(levels.map((row) => [`${row.memberId}:${row.projectId}`, row.level as ProjectLevel]));
  const quietOf = new Map(quiet.map((row) => [row.userId, row as QuietHours]));

  const rows: Array<{ notificationId: string; companyId: string; userId: string; deviceRegistrationId: string; platform: "IOS" | "ANDROID"; sendAfter: Date }> = [];
  for (const entry of entries) {
    const decision = decidePush({
      eventType: entry.eventType,
      priority: entry.priority,
      mandatory: entry.mandatory,
      categoryPushEnabled: entry.categoryPushEnabled,
      projectLevel: entry.projectId ? (levelOf.get(`${entry.memberId}:${entry.projectId}`) ?? "ALL") : "ALL",
    });
    if (!decision.push) continue;

    // Quiet hours delay ordinary push to their end; a critical alert goes at
    // once unless the person turned the override off.
    const settings = quietOf.get(entry.userId) ?? defaultQuietHours();
    const bypass = decision.urgent && settings.allowCritical;
    const sendAfter = bypass ? now : (quietHoursEnd(settings, now) ?? now);

    for (const device of devices.filter((candidate) => candidate.userId === entry.userId)) {
      if (!(await pushProviderFor(device.platform))) continue;
      rows.push({ notificationId: entry.notificationId, companyId: entry.companyId, userId: entry.userId, deviceRegistrationId: device.id, platform: device.platform, sendAfter });
    }
  }
  if (rows.length === 0) return 0;
  const result = await prisma.pushDelivery.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/** The person's unread count across every company they belong to: the one number the icon badge shows (MOB-10 §27). */
export async function badgeCountForUser(userId: string): Promise<number> {
  const members = await prisma.companyMember.findMany({ where: { userId, status: "ACTIVE" }, select: { id: true, companyId: true } });
  if (members.length === 0) return 0;
  return prisma.notification.count({
    where: { readState: "UNREAD", archivedAt: null, OR: members.map((member) => ({ companyId: member.companyId, recipientMemberId: member.id })) },
  });
}

export type PushSendResult = { claimed: number; accepted: number; retried: number; failed: number; invalidTokens: number; suppressed: number };

type ClaimedDelivery = { id: string; companyId: string; notificationId: string; userId: string; deviceRegistrationId: string | null; attemptCount: number };

async function claimDue(limit: number, workerId: string): Promise<ClaimedDelivery[]> {
  return prisma.$queryRaw<ClaimedDelivery[]>`
    WITH due AS (
      SELECT "id" FROM "push_deliveries"
      WHERE "state" = 'QUEUED' AND "sendAfter" <= ${DB_NOW} AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < ${DB_NOW})
      ORDER BY "sendAfter" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "push_deliveries" AS d
    SET "lockedBy" = ${workerId}, "leaseExpiresAt" = ${DB_NOW} + (${LEASE_SECONDS} * interval '1 second'),
        "attemptCount" = d."attemptCount" + 1, "updatedAt" = ${DB_NOW}
    FROM due
    WHERE d."id" = due."id"
    RETURNING d."id", d."companyId", d."notificationId", d."userId", d."deviceRegistrationId", d."attemptCount"`;
}

async function settle(id: string, companyId: string, data: { state: "PROVIDER_ACCEPTED" | "FAILED" | "TOKEN_INVALID" | "SUPPRESSED" | "QUEUED"; code?: string | null; messageId?: string | null; sendAfter?: Date }): Promise<void> {
  const terminal = data.state !== "QUEUED";
  // Only a delivery still QUEUED (claimed by this drain) moves; a settled row never changes again.
  await prisma.pushDelivery.updateMany({
    where: { id, companyId, state: "QUEUED" },
    data: {
      state: data.state,
      lastErrorCode: data.code ?? null,
      providerMessageId: data.messageId ?? null,
      settledAt: terminal ? new Date() : null,
      sendAfter: data.sendAfter,
      lockedBy: null,
      leaseExpiresAt: null,
    },
  });
}

/** Sends every due delivery once. Safe to run concurrently: rows are claimed, not shared. */
export async function sendDuePushDeliveries(limit: number, workerId: string, now: Date = new Date()): Promise<PushSendResult> {
  const result: PushSendResult = { claimed: 0, accepted: 0, retried: 0, failed: 0, invalidTokens: 0, suppressed: 0 };
  if (!(await pushEnabledFor())) return result;

  const batch = await claimDue(limit, workerId);
  result.claimed = batch.length;
  const badges = new Map<string, number>();

  for (const delivery of batch) {
    try {
      const [notification, device] = await Promise.all([
        prisma.notification.findFirst({
          where: { id: delivery.notificationId, companyId: delivery.companyId },
          select: { id: true, eventType: true, category: true, title: true, body: true, priority: true, readState: true, archivedAt: true, threadKey: true },
        }),
        // The device as it is now: still enabled, still this person's, session still live. A logout or
        // account switch since the row was queued ends delivery here (MOB-10 §37, §38).
        delivery.deviceRegistrationId ? pushableDevice(delivery.deviceRegistrationId, delivery.userId) : Promise.resolve(null),
      ]);

      if (!notification || !device || notification.readState === "READ" || notification.archivedAt) {
        await settle(delivery.id, delivery.companyId, { state: "SUPPRESSED", code: !device ? "DEVICE_GONE" : "NOT_ACTIONABLE" });
        result.suppressed += 1;
        continue;
      }
      const provider = await pushProviderFor(device.platform);
      if (!provider) {
        await settle(delivery.id, delivery.companyId, { state: "SUPPRESSED", code: "PROVIDER_NOT_CONFIGURED" });
        result.suppressed += 1;
        continue;
      }

      if (!badges.has(delivery.userId)) badges.set(delivery.userId, await badgeCountForUser(delivery.userId));
      const text = renderPushText({ eventType: notification.eventType, category: notification.category, title: notification.title, body: notification.body });
      const message: PushMessage = {
        notificationId: notification.id,
        eventType: notification.eventType,
        path: `/notifications/${notification.id}/open`,
        title: text.title,
        body: text.body,
        badge: badges.get(delivery.userId) ?? 0,
        threadKey: notification.threadKey,
        urgent: notification.priority === "CRITICAL",
        channel: androidChannel({ category: notification.category, priority: notification.priority }),
      };

      const platform = device.platform === "IOS" ? "ios" : "android";
      incrementCounter(Metric.PUSH_ATTEMPTED, { platform });
      const outcome = await provider.send(device.pushToken, message);

      if (outcome.kind === "accepted") {
        await settle(delivery.id, delivery.companyId, { state: "PROVIDER_ACCEPTED", messageId: outcome.providerMessageId });
        incrementCounter(Metric.PUSH_ACCEPTED, { platform });
        result.accepted += 1;
      } else if (outcome.kind === "invalid-token") {
        if (delivery.deviceRegistrationId) await disableDevice(delivery.deviceRegistrationId);
        await settle(delivery.id, delivery.companyId, { state: "TOKEN_INVALID", code: outcome.code });
        incrementCounter(Metric.PUSH_TOKEN_INVALID, { platform });
        result.invalidTokens += 1;
      } else if (outcome.kind === "transient" && delivery.attemptCount < PUSH_MAX_ATTEMPTS) {
        await settle(delivery.id, delivery.companyId, { state: "QUEUED", code: outcome.code, sendAfter: new Date(now.getTime() + pushRetryDelaySeconds(delivery.attemptCount) * 1000) });
        incrementCounter(Metric.PUSH_FAILED, { platform, final: "false" });
        result.retried += 1;
      } else {
        await settle(delivery.id, delivery.companyId, { state: "FAILED", code: outcome.kind === "transient" ? `${outcome.code}_EXHAUSTED` : outcome.code });
        incrementCounter(Metric.PUSH_FAILED, { platform, final: "true" });
        result.failed += 1;
      }
    } catch (error) {
      // Anything unexpected is a retry, never a crash of the drain; the lease holds the row back meanwhile.
      logger.error("push.send.unexpected", { deliveryId: delivery.id, attempt: delivery.attemptCount, message: error instanceof Error ? error.message : String(error) });
      const final = delivery.attemptCount >= PUSH_MAX_ATTEMPTS;
      await settle(delivery.id, delivery.companyId, { state: final ? "FAILED" : "QUEUED", code: "UNEXPECTED", sendAfter: new Date(now.getTime() + pushRetryDelaySeconds(delivery.attemptCount) * 1000) }).catch(() => undefined);
      if (final) result.failed += 1;
      else result.retried += 1;
    }
  }
  return result;
}
