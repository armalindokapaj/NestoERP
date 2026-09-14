import type { Prisma } from "@prisma/client";

import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction, recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";
import { excerpt } from "./announcement.body";
import { ACTIVITY_ENTITY, MODULE, RECORD } from "./announcement.permissions";
import { audienceMemberIds, fail, findManageableAnnouncement, resolveAnnouncementAttentionFor, validateAudience, type AnnouncementRow } from "./announcement.service";
import { PINNED_LIMIT } from "./announcement.types";

/**
 * Publishing, scheduling, pinning, expiry and archive (PRD #45 §20-§27, §44-§47,
 * §51-§57, §142-§144, §154, §155, §294, §298).
 *
 * Publishing is one transaction: the audience checked again, the status and
 * time set, the acknowledgment targets captured, the audit entry and the
 * notifications written — or none of it. Only one transition out of a draft
 * or a schedule can succeed, so the worker and a person pressing Publish at
 * the same moment publish once.
 */

type Tx = Prisma.TransactionClient;
type Actor = { context: UserContext } | { system: true };

async function publishInTransaction(tx: Tx, row: AnnouncementRow, actor: Actor, now: Date): Promise<boolean> {
  const moved = await tx.announcement.updateMany({
    where: { id: row.id, status: { in: ["DRAFT", "SCHEDULED"] }, version: row.version },
    data: { status: "PUBLISHED", publishedAt: now, publishedByMemberId: "context" in actor ? actor.context.membershipId : row.authorMemberId, version: { increment: 1 } },
  });
  if (!moved.count) return false;

  const settings = await resolveProductivitySettings(row.companyId);
  const audience = (await audienceMemberIds(tx, row)).filter((memberId) => memberId !== row.authorMemberId);
  if (row.requiresAcknowledgment && audience.length) {
    // Who was asked, as it stood when it went out (§136-§139).
    await tx.announcementTarget.createMany({ data: audience.map((memberId) => ({ announcementId: row.id, memberId, targetedAt: now })), skipDuplicates: true });
  }

  const payload = { memberIds: audience, title: row.title, excerpt: excerpt(row.body, 160), priority: row.priority, requiresAcknowledgment: row.requiresAcknowledgment ? "yes" : "", audienceLabel: row.project?.name ?? row.department?.name ?? "" };
  const eventType =
    row.priority === "CRITICAL" ? NotificationEvent.ANNOUNCEMENT_CRITICAL
    : row.requiresAcknowledgment ? NotificationEvent.ANNOUNCEMENT_ACK_REQUIRED
    : row.priority === "IMPORTANT" || settings.notifyNormalAnnouncements ? NotificationEvent.ANNOUNCEMENT_PUBLISHED
    : null;
  if (eventType && audience.length) {
    await enqueueNotificationEvent(tx, { companyId: row.companyId, eventType, moduleKey: MODULE, entityType: RECORD, entityId: row.id, actorMemberId: "context" in actor ? actor.context.membershipId : null, projectId: row.projectId, payload });
  }

  const audit = { actionKey: AuditAction.ANNOUNCEMENT_PUBLISHED, entity: { type: RECORD, id: row.id, label: row.title }, projectId: row.projectId, after: { status: "PUBLISHED", priority: row.priority, audienceType: row.audienceType, targets: row.requiresAcknowledgment ? audience.length : 0 } };
  if ("context" in actor) {
    await recordUserAction(actor.context, audit, { tx });
    // Company activity shows that it went out — never who read it (§57).
    await recordActivity(tx, actor.context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "ANNOUNCEMENT_PUBLISHED", message: `published the announcement “${row.title}”` });
  } else {
    await recordSystemAction(row.companyId, audit, { tx });
  }
  return true;
}

async function reload(id: string) {
  const { ROW_SELECT } = await import("./announcement.service");
  return prisma.announcement.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
}

export async function publishAnnouncement(context: UserContext, announcementId: string, input: { expectedVersion: number }): Promise<{ status: "PUBLISHED" }> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertPermission(context, "announcement.publish");
  if (row.status !== "DRAFT" && row.status !== "SCHEDULED") throw fail("ANNOUNCEMENT_NOT_PUBLISHABLE", "Only a draft or a scheduled announcement is published.", "CONFLICT");
  if (row.version !== input.expectedVersion) throw fail("ANNOUNCEMENT_STALE", "This announcement changed since you opened it. Reload to see the latest.", "CONFLICT");
  const now = new Date();
  if (row.expiresAt && row.expiresAt <= now) throw fail("ANNOUNCEMENT_EXPIRY_INVALID", "Its expiry has already passed. Change or clear it first.", "VALIDATION_ERROR", { field: "expiresAt" });
  // The audience is checked again at the moment it goes out (§142, §156).
  const selected = (await prisma.announcementAudienceMember.findMany({ where: { announcementId: row.id }, select: { memberId: true } })).map((entry) => entry.memberId);
  await validateAudience(context, { audienceType: row.audienceType, projectId: row.projectId, departmentId: row.departmentId, selectedMemberIds: selected });
  const published = await prisma.$transaction((tx) => publishInTransaction(tx, row, { context }, now));
  if (!published) {
    incrementCounter(Metric.ANNOUNCEMENT_PUBLISH_FAILURE);
    throw fail("ANNOUNCEMENT_STALE", "This announcement was published or changed a moment ago. Reload to see it.", "CONFLICT");
  }
  incrementCounter(Metric.ANNOUNCEMENT_PUBLISH_SUCCESS);
  return { status: "PUBLISHED" };
}

export async function scheduleAnnouncement(context: UserContext, announcementId: string, input: { expectedVersion: number; publishAt: Date }): Promise<{ status: "SCHEDULED" }> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertPermission(context, "announcement.publish");
  if (row.status !== "DRAFT") throw fail("ANNOUNCEMENT_NOT_SCHEDULABLE", "Only a draft is scheduled.", "CONFLICT");
  if (input.publishAt <= new Date()) throw fail("ANNOUNCEMENT_PUBLISH_AT_PAST", "Choose a time in the future, or publish now.", "VALIDATION_ERROR", { field: "publishAt" });
  if (row.expiresAt && row.expiresAt <= input.publishAt) throw fail("ANNOUNCEMENT_EXPIRY_INVALID", "The expiry must be after the publish time.", "VALIDATION_ERROR", { field: "expiresAt" });
  const selected = (await prisma.announcementAudienceMember.findMany({ where: { announcementId: row.id }, select: { memberId: true } })).map((entry) => entry.memberId);
  await validateAudience(context, { audienceType: row.audienceType, projectId: row.projectId, departmentId: row.departmentId, selectedMemberIds: selected });
  await prisma.$transaction(async (tx) => {
    const moved = await tx.announcement.updateMany({ where: { id: row.id, status: "DRAFT", version: input.expectedVersion }, data: { status: "SCHEDULED", publishAt: input.publishAt, version: { increment: 1 } } });
    if (!moved.count) throw fail("ANNOUNCEMENT_STALE", "This announcement changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(context, { actionKey: AuditAction.ANNOUNCEMENT_SCHEDULED, entity: { type: RECORD, id: row.id, label: row.title }, projectId: row.projectId, after: { status: "SCHEDULED", publishAt: input.publishAt.toISOString() } }, { tx });
  });
  return { status: "SCHEDULED" };
}

/** Cancels a schedule back to a draft (§155). */
export async function unscheduleAnnouncement(context: UserContext, announcementId: string, input: { expectedVersion: number }): Promise<{ status: "DRAFT" }> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertPermission(context, "announcement.publish");
  await prisma.$transaction(async (tx) => {
    const moved = await tx.announcement.updateMany({ where: { id: row.id, status: "SCHEDULED", version: input.expectedVersion }, data: { status: "DRAFT", publishAt: null, version: { increment: 1 } } });
    if (!moved.count) throw fail("ANNOUNCEMENT_STALE", "This announcement is no longer scheduled. Reload to see it.", "CONFLICT");
    await recordUserAction(context, { actionKey: AuditAction.ANNOUNCEMENT_SCHEDULED, entity: { type: RECORD, id: row.id, label: row.title }, projectId: row.projectId, before: { status: "SCHEDULED", publishAt: row.publishAt?.toISOString() ?? null }, after: { status: "DRAFT", publishAt: null } }, { tx });
  });
  return { status: "DRAFT" };
}

export async function archiveAnnouncement(context: UserContext, announcementId: string, input: { expectedVersion: number }): Promise<{ status: "ARCHIVED" }> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertPermission(context, "announcement.archive");
  if (row.status === "ARCHIVED") return { status: "ARCHIVED" };
  await prisma.$transaction(async (tx) => {
    const moved = await tx.announcement.updateMany({ where: { id: row.id, status: row.status, version: input.expectedVersion }, data: { status: "ARCHIVED", archivedAt: new Date(), pinned: false, version: { increment: 1 } } });
    if (!moved.count) throw fail("ANNOUNCEMENT_STALE", "This announcement changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(context, { actionKey: AuditAction.ANNOUNCEMENT_ARCHIVED, entity: { type: RECORD, id: row.id, label: row.title }, projectId: row.projectId, before: { status: row.status }, after: { status: "ARCHIVED" } }, { tx });
  });
  await resolveAnnouncementAttentionFor(row.companyId, row.id);
  return { status: "ARCHIVED" };
}

/** Above the ordinary feed, and at most three per audience (§24, §25). */
export async function setPinned(context: UserContext, announcementId: string, pinned: boolean, input: { expectedVersion: number }): Promise<{ pinned: boolean }> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertPermission(context, "announcement.pin");
  if (row.status === "ARCHIVED" || row.status === "EXPIRED") throw fail("ANNOUNCEMENT_READ_ONLY", "Expired and archived announcements are not pinned.", "CONFLICT");
  if (row.pinned === pinned) return { pinned };
  await prisma.$transaction(async (tx) => {
    if (pinned) {
      const now = new Date();
      const count = await tx.announcement.count({
        where: {
          companyId: row.companyId, pinned: true, id: { not: row.id }, status: { in: ["PUBLISHED", "SCHEDULED"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], audienceType: row.audienceType,
          ...(row.audienceType === "PROJECT" ? { projectId: row.projectId } : {}), ...(row.audienceType === "DEPARTMENT" ? { departmentId: row.departmentId } : {}),
        },
      });
      if (count >= PINNED_LIMIT) throw fail("ANNOUNCEMENT_PIN_LIMIT", `At most ${PINNED_LIMIT} announcements stay pinned for one audience. Unpin one first.`, "CONFLICT");
    }
    const moved = await tx.announcement.updateMany({ where: { id: row.id, version: input.expectedVersion }, data: { pinned, version: { increment: 1 } } });
    if (!moved.count) throw fail("ANNOUNCEMENT_STALE", "This announcement changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(context, { actionKey: pinned ? AuditAction.ANNOUNCEMENT_PINNED : AuditAction.ANNOUNCEMENT_UNPINNED, entity: { type: RECORD, id: row.id, label: row.title }, projectId: row.projectId, after: { pinned } }, { tx });
  });
  return { pinned };
}

/* -------------------------------------------------------------------------- */
/* Workers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Job `announcements.schedule` (§51-§53): publishes scheduled announcements
 * that are due and expires published ones past their expiry. Each transition
 * is guarded by the status it leaves, so a retry — or two workers — changes
 * each announcement once.
 */
export async function runAnnouncementSchedule(now = new Date()): Promise<{ published: number; expired: number }> {
  let published = 0;
  let expired = 0;
  const due = await prisma.announcement.findMany({ where: { status: "SCHEDULED", publishAt: { lte: now } }, orderBy: { publishAt: "asc" }, take: 200, select: { id: true } });
  for (const { id } of due) {
    const row = await reload(id);
    if (row.status !== "SCHEDULED") continue;
    try {
      if (row.expiresAt && row.expiresAt <= now) {
        // It expired before it could go out: kept as a draft for its author to decide.
        await prisma.announcement.updateMany({ where: { id: row.id, status: "SCHEDULED", version: row.version }, data: { status: "DRAFT", version: { increment: 1 } } });
        continue;
      }
      if (await prisma.$transaction((tx) => publishInTransaction(tx, row, { system: true }, now))) {
        published += 1;
        incrementCounter(Metric.ANNOUNCEMENT_PUBLISH_SUCCESS);
      }
    } catch {
      incrementCounter(Metric.ANNOUNCEMENT_PUBLISH_FAILURE);
    }
  }

  const ending = await prisma.announcement.findMany({ where: { status: "PUBLISHED", expiresAt: { lte: now } }, take: 500, select: { id: true, companyId: true, title: true, projectId: true } });
  for (const row of ending) {
    const moved = await prisma.$transaction(async (tx) => {
      const changed = await tx.announcement.updateMany({ where: { id: row.id, status: "PUBLISHED" }, data: { status: "EXPIRED", expiredAt: now, pinned: false, version: { increment: 1 } } });
      if (changed.count) await recordSystemAction(row.companyId, { actionKey: AuditAction.ANNOUNCEMENT_EXPIRED, entity: { type: RECORD, id: row.id, label: row.title }, projectId: row.projectId, after: { status: "EXPIRED" } }, { tx });
      return changed.count;
    });
    if (moved) {
      expired += 1;
      await resolveAnnouncementAttentionFor(row.companyId, row.id);
    }
  }
  if (expired) incrementCounter(Metric.ANNOUNCEMENT_EXPIRE_SUCCESS, {}, expired);
  return { published, expired };
}

/**
 * Job `announcements.reminders` (§46): the targets who have not acknowledged,
 * reminded once every few days (the company's setting) while it is live.
 */
export async function runAcknowledgmentReminders(now = new Date()): Promise<{ reminded: number }> {
  let reminded = 0;
  const rows = await prisma.announcement.findMany({
    where: { status: "PUBLISHED", requiresAcknowledgment: true, publishedAt: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    take: 500,
    select: { id: true, companyId: true, title: true, priority: true, projectId: true, publishedAt: true },
  });
  for (const row of rows) {
    const settings = await resolveProductivitySettings(row.companyId);
    const period = settings.announcementAckReminderDays * 86_400_000;
    const round = Math.floor((now.getTime() - row.publishedAt!.getTime()) / period);
    if (round < 1) continue;
    const already = await prisma.notificationEventOutbox.count({ where: { eventType: NotificationEvent.ANNOUNCEMENT_REMINDER, entityType: RECORD, entityId: row.id, payloadJson: { path: ["round"], equals: String(round) } } });
    if (already) continue;
    const acknowledged = new Set((await prisma.announcementAcknowledgment.findMany({ where: { announcementId: row.id }, select: { memberId: true } })).map((entry) => entry.memberId));
    const memberIds = (await prisma.announcementTarget.findMany({ where: { announcementId: row.id }, select: { memberId: true } })).map((entry) => entry.memberId).filter((memberId) => !acknowledged.has(memberId));
    if (!memberIds.length) continue;
    await prisma.$transaction((tx) => enqueueNotificationEvent(tx, { companyId: row.companyId, eventType: NotificationEvent.ANNOUNCEMENT_REMINDER, moduleKey: MODULE, entityType: RECORD, entityId: row.id, actorMemberId: null, projectId: row.projectId, payload: { memberIds, title: row.title, round: String(round), priority: row.priority } }));
    reminded += memberIds.length;
  }
  if (reminded) incrementCounter(Metric.ANNOUNCEMENT_ACK_REMINDER_SENT, {}, reminded);
  return { reminded };
}
