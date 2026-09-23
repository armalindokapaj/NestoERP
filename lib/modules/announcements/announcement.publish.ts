import type { Prisma } from "@prisma/client";

import { AccessError, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction, recordUserAction } from "@/lib/core/audit/audit.service";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";
import { excerpt } from "./announcement.body";
import { ACTIVITY_ENTITY, canAddress, MODULE, RECORD } from "./announcement.permissions";
import { audienceMemberIds, fail, findManageableAnnouncement, resolveAnnouncementAttentionFor, ROW_SELECT, validateAudience, type AnnouncementRow } from "./announcement.service";
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
    // A notification belongs to one member in one company: a Group announcement is sent in each
    // recipient's own company, where the dispatcher re-checks them by that company's rules (Activity Center §16, §140).
    const byCompany = new Map<string, string[]>([[row.companyId, audience]]);
    if (row.audienceType === "GROUP") {
      byCompany.clear();
      for (const member of await tx.companyMember.findMany({ where: { id: { in: audience } }, select: { id: true, companyId: true } })) {
        byCompany.set(member.companyId, [...(byCompany.get(member.companyId) ?? []), member.id]);
      }
    }
    for (const [companyId, memberIds] of byCompany) {
      await enqueueNotificationEvent(tx, { companyId, eventType, moduleKey: MODULE, entityType: RECORD, entityId: row.id, actorMemberId: "context" in actor && companyId === row.companyId ? actor.context.membershipId : null, projectId: companyId === row.companyId ? row.projectId : null, payload: { ...payload, memberIds } });
    }
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

/**
 * Managing an announcement needs the reach to address its audience now, not
 * only once (PRD #45 §33, §157, PRD #47 §62). An author who has since lost the
 * company or project grant still reads what they wrote, but no longer archives
 * or pins it — the same rule `capabilitiesFor` applies to the buttons.
 */
function assertStillAddresses(context: UserContext, row: { audienceType: AnnouncementRow["audienceType"] }) {
  if (!canAddress(context, row.audienceType)) throw new AccessError("FORBIDDEN", "You cannot manage this announcement.", { code: "ANNOUNCEMENT_AUDIENCE_FORBIDDEN" });
}

export async function archiveAnnouncement(context: UserContext, announcementId: string, input: { expectedVersion: number }): Promise<{ status: "ARCHIVED" }> {
  const row = await findManageableAnnouncement(context, announcementId);
  assertStillAddresses(context, row);
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
  assertStillAddresses(context, row);
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

const SCHEDULE_JOB = "announcements.schedule";
const REMINDER_JOB = "announcements.reminders";
/** Rows a worker reads at a time; a company with more is walked by cursor, never cut off (PRD #51 §133-§138). */
const WORKER_BATCH = 100;

type Cursor = { at: Date; id: string };

/** The rows after `cursor` in (time, id) order. */
function pastCursor(field: "publishAt" | "publishedAt" | "expiresAt", cursor: Cursor | null): Prisma.AnnouncementWhereInput {
  if (!cursor) return {};
  return { OR: [{ [field]: { gt: cursor.at } }, { [field]: cursor.at, id: { gt: cursor.id } }] } as Prisma.AnnouncementWhereInput;
}

/**
 * Hands every row `read` pages through to `handle`, a batch at a time, until
 * there are none left or the run is told to stop (PRD #51 §57, §133-§138).
 *
 * The pages are a keyset in (time, id) order rather than a fresh "first N": a
 * row that failed stays where it was, and the next page steps over it instead
 * of reading it first again — on every page and every run, ahead of everything
 * due behind it. Its failure is logged by id and counted, so the company's run
 * fails once the others have had their turn (§30-§36).
 */
async function eachAnnouncement<T extends { id: string }>(
  log: { event: string; companyId: string },
  read: (cursor: Cursor | null) => Promise<T[]>,
  timeOf: (row: T) => Date | null,
  handle: (row: T) => Promise<void>,
): Promise<number> {
  let failed = 0;
  let cursor: Cursor | null = null;
  for (;;) {
    const rows = await read(cursor);
    for (const row of rows) {
      if (jobStopRequested()) return failed;
      try {
        await handle(row);
      } catch (error) {
        failed += 1;
        logger.error(log.event, { companyId: log.companyId, announcementId: row.id, ...serialiseError(error) });
      }
    }
    if (rows.length < WORKER_BATCH) return failed;
    const last = rows[rows.length - 1];
    cursor = { at: timeOf(last)!, id: last.id };
  }
}

type ScheduleTotals = { published: number; expired: number; returnedToDraft: number };

/**
 * Job `announcements.schedule` (§51-§53): publishes scheduled announcements
 * that are due and expires published ones past their expiry. Each transition
 * is guarded by the state and version it read, so a retry — or two workers —
 * changes each announcement once, with one audit entry and one notification.
 *
 * One company at a time and only active ones (PRD #51 §10, §145): a suspended
 * company's schedule would go out to an audience the dispatcher then drops,
 * and nobody would be told once it is reactivated. Its schedules wait, and go
 * out on the first run after reactivation if they have not expired by then.
 */
export async function runAnnouncementSchedule(now = new Date()): Promise<ScheduleTotals> {
  const totals: ScheduleTotals = { published: 0, expired: 0, returnedToDraft: 0 };
  const run = await forEachCompany(SCHEDULE_JOB, async ({ companyId }) => {
    const log = { event: `${SCHEDULE_JOB}.item_failed`, companyId };
    // A company that has switched announcements off shows nobody a feed, so a
    // schedule there waits rather than notify people of what they cannot open.
    // Expiry still runs: it only takes things away.
    const { announcementsEnabled } = await resolveProductivitySettings(companyId);

    const unpublished = await eachAnnouncement(
      log,
      (cursor) =>
        prisma.announcement.findMany({
          where: { AND: [{ companyId, status: "SCHEDULED", publishAt: { lte: now } }, pastCursor("publishAt", cursor)] },
          orderBy: [{ publishAt: "asc" }, { id: "asc" }],
          take: WORKER_BATCH,
          select: ROW_SELECT,
        }),
      (row) => row.publishAt,
      async (row) => {
        if (row.expiresAt && row.expiresAt <= now) {
          if (await returnExpiredScheduleToDraft(row)) totals.returnedToDraft += 1;
        } else if (announcementsEnabled && (await prisma.$transaction((tx) => publishInTransaction(tx, row, { system: true }, now)))) {
          totals.published += 1;
          incrementCounter(Metric.ANNOUNCEMENT_PUBLISH_SUCCESS);
        }
      },
    );
    if (unpublished) incrementCounter(Metric.ANNOUNCEMENT_PUBLISH_FAILURE, {}, unpublished);

    const unexpired = await eachAnnouncement(
      log,
      (cursor) =>
        prisma.announcement.findMany({
          where: { AND: [{ companyId, status: "PUBLISHED", expiresAt: { lte: now } }, pastCursor("expiresAt", cursor)] },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: WORKER_BATCH,
          select: { id: true, title: true, projectId: true, expiresAt: true },
        }),
      (row) => row.expiresAt,
      async (row) => {
        const moved = await prisma.$transaction(async (tx) => {
          // Bound to the expiry as well as the state: one a person has just moved later is not overtaken.
          const changed = await tx.announcement.updateMany({ where: { id: row.id, companyId, status: "PUBLISHED", expiresAt: { lte: now } }, data: { status: "EXPIRED", expiredAt: now, pinned: false, version: { increment: 1 } } });
          if (changed.count) await recordSystemAction(companyId, { actionKey: AuditAction.ANNOUNCEMENT_EXPIRED, entity: { type: RECORD, id: row.id, label: row.title }, projectId: row.projectId, after: { status: "EXPIRED" } }, { tx });
          return changed.count > 0;
        });
        if (!moved) return;
        totals.expired += 1;
        await resolveAnnouncementAttentionFor(companyId, row.id);
      },
    );

    if (unpublished + unexpired) throw new JobError("PARTIAL_FAILURE", `${unpublished + unexpired} announcements could not be published or expired`);
  });
  if (totals.expired) incrementCounter(Metric.ANNOUNCEMENT_EXPIRE_SUCCESS, {}, totals.expired);
  assertEveryCompanySucceeded(SCHEDULE_JOB, run);
  return totals;
}

/**
 * A schedule whose expiry passed before it could go out is kept as a draft for
 * its author to decide. It is the move a person makes with Unschedule, and is
 * written the same way: `publishAt` cleared, guarded on the state and version
 * read, and audited — as the system (PRD #51 §148, §149).
 */
async function returnExpiredScheduleToDraft(row: AnnouncementRow): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const moved = await tx.announcement.updateMany({ where: { id: row.id, companyId: row.companyId, status: "SCHEDULED", version: row.version }, data: { status: "DRAFT", publishAt: null, version: { increment: 1 } } });
    if (!moved.count) return false;
    await recordSystemAction(
      row.companyId,
      {
        actionKey: AuditAction.ANNOUNCEMENT_SCHEDULED,
        entity: { type: RECORD, id: row.id, label: row.title },
        projectId: row.projectId,
        before: { status: "SCHEDULED", publishAt: row.publishAt?.toISOString() ?? null },
        after: { status: "DRAFT", publishAt: null },
        reason: "Its expiry passed before it was published.",
      },
      { tx },
    );
    return true;
  });
}

/**
 * Job `announcements.reminders` (§46): the targets who have not acknowledged,
 * reminded once every few days (the company's setting) while it is live.
 *
 * Every live announcement is reached, oldest first, however many a company
 * has accumulated. A round is claimed in the idempotency ledger in the
 * transaction that enqueues it, so two runs — or a run after retention has
 * purged the first reminder from the outbox — never remind the same round
 * twice (PRD #51 §15-§19). A suspended company is skipped; once reactivated,
 * its members are reminded for the round they are in, not the ones they missed.
 */
export async function runAcknowledgmentReminders(now = new Date()): Promise<{ reminded: number }> {
  let reminded = 0;
  const run = await forEachCompany(REMINDER_JOB, async ({ companyId }) => {
    const settings = await resolveProductivitySettings(companyId);
    // Switched off: nobody can open an announcement to acknowledge it.
    if (!settings.announcementsEnabled) return;
    const period = settings.announcementAckReminderDays * 86_400_000;
    const failed = await eachAnnouncement(
      { event: `${REMINDER_JOB}.item_failed`, companyId },
      (cursor) =>
        prisma.announcement.findMany({
          where: {
            AND: [
              // Out for at least one period: its first round is due.
              { companyId, status: "PUBLISHED", requiresAcknowledgment: true, publishedAt: { lte: new Date(now.getTime() - period) }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
              pastCursor("publishedAt", cursor),
            ],
          },
          orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
          take: WORKER_BATCH,
          select: { id: true, title: true, priority: true, projectId: true, publishedAt: true },
        }),
      (row) => row.publishedAt,
      async (row) => {
        const count = await remindRound(companyId, row, Math.floor((now.getTime() - row.publishedAt!.getTime()) / period));
        reminded += count;
      },
    );
    if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} announcements could not be reminded`);
  });
  if (reminded) incrementCounter(Metric.ANNOUNCEMENT_ACK_REMINDER_SENT, {}, reminded);
  assertEveryCompanySucceeded(REMINDER_JOB, run);
  return { reminded };
}

/** One round of one announcement, to whoever has still not acknowledged it. Returns how many were reminded. */
async function remindRound(companyId: string, row: { id: string; title: string; priority: AnnouncementRow["priority"]; projectId: string | null }, round: number): Promise<number> {
  const claim = { companyId, jobKey: REMINDER_JOB, key: `${row.id}:${round}` };
  // Most live announcements were settled for their round on an earlier run: one key read, not every target.
  if (await idempotencyKeyClaimed(prisma, claim)) return 0;
  return prisma.$transaction(async (tx) => {
    // Claimed even when everybody has acknowledged: the round is settled, and not re-read every hour until the next.
    if (!(await claimIdempotencyKey(tx, claim))) return 0;
    const acknowledged = new Set((await tx.announcementAcknowledgment.findMany({ where: { announcementId: row.id }, select: { memberId: true } })).map((entry) => entry.memberId));
    const memberIds = (await tx.announcementTarget.findMany({ where: { announcementId: row.id }, select: { memberId: true } })).map((entry) => entry.memberId).filter((memberId) => !acknowledged.has(memberId));
    if (!memberIds.length) return 0;
    await enqueueNotificationEvent(tx, { companyId, eventType: NotificationEvent.ANNOUNCEMENT_REMINDER, moduleKey: MODULE, entityType: RECORD, entityId: row.id, actorMemberId: null, projectId: row.projectId, payload: { memberIds, title: row.title, round: String(round), priority: row.priority } });
    return memberIds.length;
  });
}
