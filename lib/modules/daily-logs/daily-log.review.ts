import type { Prisma } from "@prisma/client";
import type { z } from "zod";

import { can } from "@/lib/access/can";
import { assertPermission } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionFor } from "@/lib/core/notifications/attention.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { dailyLogsOpen, isEditable, MODULE, readableDailyLogWhere, RECORD } from "./daily-log.permissions";
import type { correctionSchema } from "./daily-log.schema";
import { ACTIVITY_ENTITY, fail, findReadableLog, lockedError, type ReadableLog } from "./daily-log.service";
import { resolveDailyLogSettings } from "./daily-log.settings";
import { dateLabel, dateOf } from "./daily-log.time";

/**
 * Submit, review, return, lock, void and correct (PRD #43 §87-§102, §185,
 * §192, §233-§236, §244).
 *
 * A native lifecycle, not a business approval (§207, §208): review says the
 * record is complete, lock makes it the official record. Every transition
 * checks the version the person was looking at, runs in one transaction with
 * its audit and notification, and never lets the person who submitted a log
 * review it. A locked log is never edited again; a correction is appended
 * beside it.
 */

type Tx = Prisma.TransactionClient;

async function contributors(tx: Tx, log: ReadableLog): Promise<string[]> {
  const authors = await tx.dailyLogWorkActivity.findMany({ where: { dailyLogId: log.id }, select: { createdByMemberId: true }, distinct: ["createdByMemberId"] });
  return [...new Set([log.createdByMemberId, log.submittedByMemberId, ...authors.map((row) => row.createdByMemberId)].filter((id): id is string => Boolean(id)))];
}

function payloadFor(log: ReadableLog, extra: Record<string, unknown> = {}) {
  return { projectName: log.project.name, dateLabel: dateLabel(dateOf(log.workDate)), workDate: dateOf(log.workDate), ...extra };
}

/**
 * Who reviews a project's log (§88, §89, §233): the project's named reviewer,
 * else its project manager — an active member who can review daily logs and
 * open this log, and not the person submitting it.
 */
export async function resolveReviewer(companyId: string, log: Pick<ReadableLog, "id" | "projectId" | "project">, submitterId: string): Promise<string | null> {
  const settings = await resolveDailyLogSettings(companyId, log.projectId);
  const candidates = [settings.reviewerMemberId, log.project.projectManagerMemberId].filter((id): id is string => Boolean(id) && id !== submitterId);
  if (candidates.length === 0) return null;
  const contexts = await buildMemberContexts(companyId, candidates);
  for (const id of candidates) {
    const memberContext = contexts.get(id);
    if (!memberContext || !dailyLogsOpen(memberContext) || !can(memberContext, "daily_log.review")) continue;
    const readable = await prisma.dailyLog.count({ where: { AND: [readableDailyLogWhere(memberContext), { id: log.id }] } });
    if (readable) return id;
  }
  return null;
}

async function transition(tx: Tx, log: ReadableLog, expectedVersion: number, from: Prisma.EnumDailyLogStatusFilter["in"], data: Prisma.DailyLogUpdateManyMutationInput) {
  const moved = await tx.dailyLog.updateMany({ where: { id: log.id, version: expectedVersion, status: { in: from } }, data: { ...data, version: { increment: 1 } } });
  if (moved.count === 0) throw fail("DAILY_LOG_STALE", "This log changed since you opened it. Reload to see the latest.", "CONFLICT");
}

export async function submitDailyLog(context: UserContext, dailyLogId: string, input: { expectedVersion: number }) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.submit");
  if (!isEditable(log.status)) throw lockedError(log.status);
  if (log.version !== input.expectedVersion) throw fail("DAILY_LOG_STALE", "This log changed since you opened it. Reload to see the latest.", "CONFLICT");

  // §185, checked against the database as it is now.
  const [activities, workforce, evidence, badHeadcount] = await Promise.all([
    prisma.dailyLogWorkActivity.count({ where: { dailyLogId: log.id } }),
    prisma.dailyLogWorkforceEntry.count({ where: { dailyLogId: log.id } }),
    prisma.document.count({ where: { companyId: context.companyId, entityType: RECORD, entityId: log.id, status: { not: "ARCHIVED" } } }),
    prisma.dailyLogWorkforceEntry.count({ where: { dailyLogId: log.id, headcount: { lt: 1 } } }),
  ]);
  const issues: Array<{ section: string; message: string }> = [];
  if (activities + workforce + evidence === 0) issues.push({ section: "activities", message: "Record at least one work activity, workforce entry or photo." });
  if (badHeadcount) issues.push({ section: "workforce", message: "Every workforce entry needs a headcount of at least 1." });
  if (issues.length) throw fail("DAILY_LOG_INCOMPLETE", `${issues.length} ${issues.length === 1 ? "issue needs" : "issues need"} attention before submitting.`, "VALIDATION_ERROR", { issues });

  const settings = await resolveDailyLogSettings(context.companyId, log.projectId);
  const reviewerMemberId = await resolveReviewer(context.companyId, log, context.membershipId);
  if (!reviewerMemberId && settings.reviewerRequired) throw fail("DAILY_LOG_NO_REVIEWER", "Nobody else can review this project's logs yet. Ask for a reviewer to be named for the project.");

  await prisma.$transaction(async (tx) => {
    await transition(tx, log, input.expectedVersion, ["DRAFT", "CORRECTION_REQUIRED"], {
      status: "SUBMITTED", submittedAt: new Date(), submittedByMemberId: context.membershipId, reviewerMemberId, submissionCount: { increment: 1 }, returnReason: null,
    });
    await resolveAttentionFor(tx, { companyId: context.companyId, entityType: RECORD, entityId: log.id, conditionKeys: ["DAILY_LOG_RETURNED"] });
    if (reviewerMemberId) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId, eventType: NotificationEvent.DAILY_LOG_SUBMITTED, moduleKey: MODULE, entityType: RECORD, entityId: log.id, actorMemberId: context.membershipId, projectId: log.projectId,
        payload: payloadFor(log, { reviewerMemberId, actorName: context.fullName, submissionCount: String(log.submissionCount + 1) }),
      });
    }
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: log.id, action: "DAILY_LOG_SUBMITTED", message: "submitted the daily log" });
    await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_SUBMITTED, entity: { type: RECORD, id: log.id }, after: { status: "SUBMITTED", reviewerMemberId, submissionCount: log.submissionCount + 1 } }, { tx });
  });
  incrementCounter(Metric.DAILY_LOG_SUBMIT_SUCCESS);
  return { reviewerMemberId };
}

function assertNotSubmitter(context: UserContext, log: ReadableLog) {
  if (log.submittedByMemberId === context.membershipId) {
    throw fail("DAILY_LOG_SELF_REVIEW_BLOCKED", "You submitted this log, so somebody else reviews it.", "FORBIDDEN");
  }
}

export async function reviewDailyLog(context: UserContext, dailyLogId: string, input: { expectedVersion: number }) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.review");
  if (log.status !== "SUBMITTED") throw fail("DAILY_LOG_NOT_SUBMITTED", "Only a submitted log is reviewed.", "CONFLICT");
  assertNotSubmitter(context, log);
  await prisma.$transaction(async (tx) => {
    await transition(tx, log, input.expectedVersion, ["SUBMITTED"], { status: "REVIEWED", reviewedAt: new Date(), reviewedByMemberId: context.membershipId });
    await resolveReviewAttention(tx, context.companyId, log.id);
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId, eventType: NotificationEvent.DAILY_LOG_REVIEWED, moduleKey: MODULE, entityType: RECORD, entityId: log.id, actorMemberId: context.membershipId, projectId: log.projectId,
      payload: payloadFor(log, { memberIds: await contributors(tx, log), actorName: context.fullName }),
    });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: log.id, action: "DAILY_LOG_REVIEWED", message: "reviewed the daily log" });
    await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_REVIEWED, entity: { type: RECORD, id: log.id }, after: { status: "REVIEWED", submissionCount: log.submissionCount } }, { tx });
  });
  incrementCounter(Metric.DAILY_LOG_REVIEW_SUCCESS);
}

async function resolveReviewAttention(tx: Tx, companyId: string, dailyLogId: string) {
  await resolveAttentionFor(tx, { companyId, entityType: RECORD, entityId: dailyLogId, conditionKeys: ["DAILY_LOG_AWAITING_REVIEW"] });
}

export async function returnDailyLog(context: UserContext, dailyLogId: string, input: { expectedVersion: number; reason: string }) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.return");
  if (log.status !== "SUBMITTED") throw fail("DAILY_LOG_NOT_SUBMITTED", "Only a submitted log is returned.", "CONFLICT");
  assertNotSubmitter(context, log);
  if (!input.reason.trim()) throw fail("DAILY_LOG_REASON_REQUIRED", "Say what needs correcting.");
  await prisma.$transaction(async (tx) => {
    await transition(tx, log, input.expectedVersion, ["SUBMITTED"], { status: "CORRECTION_REQUIRED", returnedAt: new Date(), returnedByMemberId: context.membershipId, returnReason: input.reason });
    await resolveReviewAttention(tx, context.companyId, log.id);
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId, eventType: NotificationEvent.DAILY_LOG_RETURNED, moduleKey: MODULE, entityType: RECORD, entityId: log.id, actorMemberId: context.membershipId, projectId: log.projectId,
      payload: payloadFor(log, { memberIds: await contributors(tx, log), reason: input.reason }),
    });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: log.id, action: "DAILY_LOG_RETURNED", message: "returned the daily log for correction", metadata: { note: input.reason } as Prisma.InputJsonValue });
    await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_RETURNED, entity: { type: RECORD, id: log.id }, after: { status: "CORRECTION_REQUIRED", submissionCount: log.submissionCount }, reason: input.reason }, { tx });
  });
}

export async function lockDailyLog(context: UserContext, dailyLogId: string, input: { expectedVersion: number }) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.lock");
  if (log.status !== "REVIEWED") throw fail("DAILY_LOG_NOT_REVIEWED", "A log is reviewed before it is locked.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    await transition(tx, log, input.expectedVersion, ["REVIEWED"], { status: "LOCKED", lockedAt: new Date(), lockedByMemberId: context.membershipId });
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId, eventType: NotificationEvent.DAILY_LOG_LOCKED, moduleKey: MODULE, entityType: RECORD, entityId: log.id, actorMemberId: context.membershipId, projectId: log.projectId,
      payload: payloadFor(log, { memberIds: await contributors(tx, log) }),
    });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: log.id, action: "DAILY_LOG_LOCKED", message: "locked the daily log as the official record" });
    await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_LOCKED, entity: { type: RECORD, id: log.id }, after: { status: "LOCKED" } }, { tx });
  });
  incrementCounter(Metric.DAILY_LOG_LOCK_SUCCESS);
}

/** Invalidates a log, kept in history with its reason (§95, §221, §235). */
export async function voidDailyLog(context: UserContext, dailyLogId: string, input: { expectedVersion: number; reason: string }) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.void");
  if (log.status === "VOID") throw fail("DAILY_LOG_VOID", "This log was already voided.", "CONFLICT");
  if (!input.reason.trim()) throw fail("DAILY_LOG_REASON_REQUIRED", "Say why the log is void.");
  await prisma.$transaction(async (tx) => {
    await transition(tx, log, input.expectedVersion, ["DRAFT", "SUBMITTED", "REVIEWED", "LOCKED", "CORRECTION_REQUIRED"], { status: "VOID", voidedAt: new Date(), voidedByMemberId: context.membershipId, voidReason: input.reason });
    // A void log raises nothing any more, whichever condition put it there.
    await resolveAttentionFor(tx, { companyId: context.companyId, entityType: RECORD, entityId: log.id });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: log.id, action: "DAILY_LOG_VOIDED", message: "voided the daily log", metadata: { note: input.reason } as Prisma.InputJsonValue });
    await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_VOIDED, entity: { type: RECORD, id: log.id }, before: { status: log.status }, after: { status: "VOID" }, reason: input.reason }, { tx });
  });
}

/**
 * An official correction to a locked log (§97-§102, §236): appended, audited,
 * announced; the locked record itself is never touched.
 */
export async function addCorrection(context: UserContext, dailyLogId: string, input: z.infer<typeof correctionSchema>) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.correct_locked");
  if (log.status !== "LOCKED") throw fail("DAILY_LOG_NOT_LOCKED", "Corrections are added to a locked log; edit a log that is still being written.", "CONFLICT");
  const correction = await prisma.$transaction(async (tx) => {
    const row = await tx.dailyLogCorrection.create({
      data: { companyId: context.companyId, dailyLogId: log.id, reason: input.reason, correctionSummary: input.correctionSummary, createdByMemberId: context.membershipId, approvedByMemberId: context.membershipId, approvedAt: new Date() },
      select: { id: true },
    });
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId, eventType: NotificationEvent.DAILY_LOG_CORRECTION_ADDED, moduleKey: MODULE, entityType: RECORD, entityId: log.id, actorMemberId: context.membershipId, projectId: log.projectId,
      payload: payloadFor(log, { memberIds: [...(await contributors(tx, log)), ...(log.reviewerMemberId ? [log.reviewerMemberId] : [])], reason: input.reason }),
    });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: log.id, action: "DAILY_LOG_CORRECTION_ADDED", message: "added an official correction", metadata: { note: input.reason } as Prisma.InputJsonValue });
    await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_CORRECTION_ADDED, entity: { type: RECORD, id: log.id }, after: { correctionId: row.id, status: "LOCKED" }, reason: input.reason }, { tx });
    return row;
  });
  return { correctionId: correction.id };
}
