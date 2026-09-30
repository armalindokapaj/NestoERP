import { hostname } from "node:os";

import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { appLink } from "@/lib/config/app-url";
import { mailDeliveryEnabled } from "@/lib/config/env";
import { buildMemberContexts } from "@/lib/context/member-context";
import { DB_NOW } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { currentJobRun } from "@/lib/core/jobs/job.context";
import { classifyJobError, JobError, type ClassifiedError } from "@/lib/core/jobs/job.errors";
import { markFailuresRetried, recordJobFailure } from "@/lib/core/jobs/job.failures";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { runWithRequestScope } from "@/lib/core/observability/request-scope";
import { currentRequestContext, newCorrelationId, newRequestId, runWithRequestContext } from "@/lib/core/observability/request-context";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import { sendMail } from "@/lib/mail";
import type { MailTemplateKey } from "@/lib/mail/mail.types";
import { findNotificationEvent, readPayload, type OutboxEvent } from "./notification.events";
import { deliveryPreferences } from "./notification.preferences";
import { queuePush, type QueuedNotification } from "./push.service";

/**
 * The outbox dispatcher (PRD #25 §25, §230-§245, PRD #38 §79-§82).
 *
 * Producers enqueue an event inside their own transaction, so nothing is ever
 * delivered for a mutation that rolled back. This drains that outbox and turns
 * each event into notifications for the people entitled to hear about it.
 *
 * Claiming is a lease. A worker takes a batch with FOR UPDATE SKIP LOCKED —
 * two workers never hold the same row — marks it PROCESSING with an expiry,
 * and only the holder of that lease may settle it. A worker that dies
 * mid-batch leaves leases that expire and are claimed again; the unique dedupe
 * key on notifications makes the second attempt produce nothing twice
 * (PRD #38 §80, §96, §155).
 *
 * Delivery is where entitlement is decided. Every candidate's context is built
 * from their live membership and the event's record is read through the record
 * registry in that context — the check a page would make — before a row is
 * written. Somebody suspended, moved off the project, or whose company turned
 * the module off since the event hears nothing (PRD #38 §82).
 *
 * Failure (PRD #51 §99-§105, §206):
 * - An attempt is counted when the row is claimed, not when it fails — so a
 *   worker that crashes or hangs mid-event has still spent one, and a poison
 *   event reaches FAILED after `MAX_ATTEMPTS` instead of being claimed forever
 *   at the head of the queue.
 * - Every failure is classified. A permanent one (bad data, a rule the event
 *   breaks) is FAILED at once; a retryable one waits a jittered, growing delay.
 * - Every failed attempt is kept in `job_failures`. An operator's retry sends
 *   FAILED events round again with a fresh set of attempts and erases none of
 *   that history.
 * - Leases and delays are on the database's clock.
 */

export const MAX_ATTEMPTS = 5;
const BACKOFF_INITIAL_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 3600;
/** Long enough for a full batch; a worker stops taking rows from its claim well before it runs out. */
const LEASE_SECONDS = 300;
const LEASE_MARGIN_SECONDS = 60;
/** The payload shape this build reads (§223). */
export const OUTBOX_SCHEMA_VERSION = 1;
const JOB_KEY = "notifications.dispatch";

export type DispatchResult = {
  processed: number;
  notificationsCreated: number;
  emailsSent: number;
  failed: number;
};

/**
 * Older producers wrote the model name or an upper-case key; the registry
 * speaks in its own record types. Rows already in the outbox keep dispatching.
 */
const LEGACY_ENTITY_TYPES: Record<string, string> = {
  Task: "task",
  INVOICE: "invoice",
  EXPENSE: "expense",
  BUDGET: "budget",
  COMMITMENT: "commitment",
  LeaveRequest: "leave_request",
};

export function normaliseEntityType(entityType: string): string {
  return LEGACY_ENTITY_TYPES[entityType] ?? entityType;
}

/** 30 s, 2 min, 8 min, 32 min, capped at an hour, each ±20% so a burst of failures does not retry as a burst. */
export function outboxRetryDelaySeconds(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_INITIAL_SECONDS * 4 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.round(base * (0.8 + 0.4 * random())));
}

export function workerIdentity(): string {
  return `${hostname()}:${process.pid}`;
}

type ClaimedRow = OutboxEvent & {
  /** Attempts started, this one included. */
  attemptCount: number;
  correlationId: string | null;
  schemaVersion: number;
  createdAt: Date;
  /** The worker whose lease on this row ran out, when this claim took it over. */
  previousOwner: string | null;
};

/**
 * FAILED for every event whose lease ran out on its last allowed attempt: the
 * worker holding it died or hung on it `MAX_ATTEMPTS` times (§272 "poison jobs
 * do not block queue").
 */
async function failAbandonedEvents(workerId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string; companyId: string; attemptCount: number; correlationId: string | null; lockedBy: string | null }>>`
    WITH abandoned AS (
      SELECT "id", "lockedBy" FROM "notification_event_outbox"
      WHERE "status" = 'PROCESSING' AND "leaseExpiresAt" < ${DB_NOW} AND "attemptCount" >= ${MAX_ATTEMPTS}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "notification_event_outbox" AS o
    SET "status" = 'FAILED', "failedAt" = ${DB_NOW}, "lastErrorCode" = 'LEASE_EXPIRED',
        "lastError" = 'the worker processing this event stopped before finishing it, on every attempt',
        "lockedAt" = NULL, "lockedBy" = NULL, "leaseExpiresAt" = NULL, "nextAttemptAt" = NULL, "updatedAt" = ${DB_NOW}
    FROM abandoned
    WHERE o."id" = abandoned."id"
    RETURNING o."id", o."companyId", o."attemptCount", o."correlationId", abandoned."lockedBy"`;
  for (const row of rows) {
    const error: ClassifiedError = { code: "LEASE_EXPIRED", retryable: false, message: `lease held by ${row.lockedBy ?? "a worker"} expired on the last attempt` };
    await recordJobFailure({ jobKey: JOB_KEY, companyId: row.companyId, sourceType: "notification_event", sourceId: row.id, attempt: row.attemptCount, error, correlationId: row.correlationId, workerId });
    logger.error("notification.dispatch.abandoned", { outboxId: row.id, attempt: row.attemptCount, previousOwner: row.lockedBy });
  }
  return rows.length;
}

/** Claims up to `limit` due events for this worker, counting the attempt. Expired leases are due again. */
export async function claimOutboxBatch(limit: number, workerId: string): Promise<ClaimedRow[]> {
  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    WITH due AS (
      SELECT "id", CASE WHEN "status" = 'PROCESSING' THEN "lockedBy" END AS "previousOwner"
      FROM "notification_event_outbox"
      WHERE ("status" = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${DB_NOW}))
         OR ("status" = 'PROCESSING' AND "leaseExpiresAt" < ${DB_NOW} AND "attemptCount" < ${MAX_ATTEMPTS})
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "notification_event_outbox" AS o
    SET "status" = 'PROCESSING',
        "lockedAt" = ${DB_NOW},
        "lockedBy" = ${workerId},
        "leaseExpiresAt" = ${DB_NOW} + (${LEASE_SECONDS} * interval '1 second'),
        "attemptCount" = o."attemptCount" + 1,
        "updatedAt" = ${DB_NOW}
    FROM due
    WHERE o."id" = due."id"
    RETURNING o."id", o."companyId", o."eventType", o."moduleKey", o."entityType", o."entityId",
              o."actorMemberId", o."projectId", o."payloadJson", o."attemptCount", o."correlationId",
              o."schemaVersion", o."createdAt", due."previousOwner"`;
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/** Hands claimed rows back untouched — shutdown, or a claim about to run out — without spending their attempt. */
async function releaseClaimed(ids: string[], workerId: string): Promise<number> {
  if (ids.length === 0) return 0;
  return prisma.$executeRaw`
    UPDATE "notification_event_outbox"
    SET "status" = 'PENDING', "attemptCount" = GREATEST("attemptCount" - 1, 0), "nextAttemptAt" = ${DB_NOW},
        "lockedAt" = NULL, "lockedBy" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ${DB_NOW}
    WHERE "id" = ANY(${ids}) AND "lockedBy" = ${workerId} AND "status" = 'PROCESSING'`;
}

async function settleFailure(row: ClaimedRow, workerId: string, error: ClassifiedError): Promise<{ final: boolean }> {
  const final = !error.retryable || row.attemptCount >= MAX_ATTEMPTS;
  const delay = outboxRetryDelaySeconds(row.attemptCount);
  await prisma.$executeRaw`
    UPDATE "notification_event_outbox"
    SET "status" = ${final ? "FAILED" : "PENDING"}::"NotificationOutboxStatus",
        "nextAttemptAt" = ${final ? null : DB_NOW}::timestamp(3) + (${final ? 0 : delay} * interval '1 second'),
        "failedAt" = CASE WHEN ${final} THEN ${DB_NOW} ELSE "failedAt" END,
        "lastError" = ${error.message},
        "lastErrorCode" = ${error.code},
        "lockedAt" = NULL, "lockedBy" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ${DB_NOW}
    WHERE "id" = ${row.id} AND "lockedBy" = ${workerId} AND "status" = 'PROCESSING'`;
  await recordJobFailure({
    jobKey: JOB_KEY,
    companyId: row.companyId,
    sourceType: "notification_event",
    sourceId: row.id,
    attempt: row.attemptCount,
    error,
    correlationId: row.correlationId,
    workerId,
  });
  return { final };
}

export async function dispatchNotifications(limit = 100, workerId = workerIdentity(), options: { signal?: AbortSignal } = {}): Promise<DispatchResult> {
  const result: DispatchResult = { processed: 0, notificationsCreated: 0, emailsSent: 0, failed: 0 };
  const signal = options.signal ?? currentJobRun()?.signal;
  if (signal?.aborted) return result;

  await failAbandonedEvents(workerId);
  const claimedAt = Date.now();
  const batch = await claimOutboxBatch(limit, workerId);
  const companyActive = new Map<string, boolean>();

  for (const [index, row] of batch.entries()) {
    // Stop taking rows from the claim on shutdown, or before the lease on the
    // rest could run out underneath this worker; they go straight back.
    if (signal?.aborted || Date.now() - claimedAt > (LEASE_SECONDS - LEASE_MARGIN_SECONDS) * 1000) {
      await releaseClaimed(batch.slice(index).map((rest) => rest.id), workerId);
      break;
    }

    const correlationId = row.correlationId ?? currentJobRun()?.correlationId ?? newCorrelationId();
    await runWithRequestContext(
      { requestId: newRequestId(), correlationId, startedAt: Date.now(), route: `job:${JOB_KEY}`, companyId: row.companyId, jobKey: JOB_KEY, workerId },
      () => runWithRequestScope(async () => {
        if (row.previousOwner) {
          logger.warn("notification.dispatch.lease_recovered", { outboxId: row.id, attempt: row.attemptCount, previousOwner: row.previousOwner });
          await recordJobFailure({
            jobKey: JOB_KEY,
            companyId: row.companyId,
            sourceType: "notification_event",
            sourceId: row.id,
            attempt: row.attemptCount - 1,
            error: { code: "LEASE_EXPIRED", retryable: true, message: `lease held by ${row.previousOwner} expired; taken over` },
            correlationId,
            workerId,
          }).catch(() => undefined);
        }
        try {
          if (!companyActive.has(row.companyId)) {
            const company = await prisma.company.findUnique({ where: { id: row.companyId }, select: { status: true } });
            companyActive.set(row.companyId, company?.status === "ACTIVE");
          }
          // A suspended company's members cannot sign in to read anything:
          // its events are settled without delivery (§145).
          const outcome = companyActive.get(row.companyId) ? await dispatchOne(row) : { created: 0, emailed: 0 };
          // Settled only by the lease holder: a row whose lease expired and was
          // re-claimed belongs to the other worker now, and is theirs to count.
          const settled = await prisma.notificationEventOutbox.updateMany({
            where: { id: row.id, lockedBy: workerId, status: "PROCESSING" },
            data: { status: "PROCESSED", processedAt: new Date(), lastError: null, lastErrorCode: null, lockedAt: null, lockedBy: null, leaseExpiresAt: null },
          });
          result.notificationsCreated += outcome.created;
          result.emailsSent += outcome.emailed;
          if (settled.count === 1) {
            result.processed += 1;
            incrementCounter(Metric.NOTIFICATION_DISPATCH_SUCCESS, { event: row.eventType });
          } else {
            logger.warn("notification.dispatch.lease_lost", { outboxId: row.id, attempt: row.attemptCount });
          }
        } catch (caught) {
          const error = classifyJobError(caught);
          const { final } = await settleFailure(row, workerId, error);
          incrementCounter(Metric.NOTIFICATION_DISPATCH_FAILURE, { event: row.eventType });
          logger.error(final ? "notification.dispatch.failed_permanently" : "notification.dispatch.failed", {
            outboxId: row.id,
            eventType: row.eventType,
            attempt: row.attemptCount,
            errorCode: error.code,
            retryable: error.retryable,
            ...serialiseError(caught),
          });
          result.failed += 1;
        }
      }),
    );
  }

  return result;
}

export type ManualRetry = {
  /** Who is sending the events round again — kept on the failure history (§38-§40). */
  operator: string;
  ids?: string[];
  eventType?: string;
  companyId?: string;
};

/**
 * Returns FAILED events to the queue for another full set of attempts
 * (PRD #38 §81, PRD #51 §38-§40, §205).
 *
 * The event's own last error stays on it until the next attempt settles, and
 * every earlier failure stays in `job_failures`, marked with who retried it.
 * Only reachable from the worker CLI, which is to say by an operator with shell
 * access to the deployment; there is no HTTP route (§216).
 */
export async function retryFailedNotificationEvents(retry: ManualRetry): Promise<{ count: number; ids: string[] }> {
  const operator = retry.operator.trim();
  if (!operator) throw new JobError("CONFIGURATION", "A manual retry must name its operator");

  const filters = [Prisma.sql`"status" = 'FAILED'`];
  if (retry.ids?.length) filters.push(Prisma.sql`"id" = ANY(${retry.ids})`);
  if (retry.eventType) filters.push(Prisma.sql`"eventType" = ${retry.eventType}`);
  if (retry.companyId) filters.push(Prisma.sql`"companyId" = ${retry.companyId}`);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "notification_event_outbox"
    SET "status" = 'PENDING', "attemptCount" = 0, "nextAttemptAt" = ${DB_NOW}, "manualRetries" = "manualRetries" + 1, "updatedAt" = ${DB_NOW}
    WHERE ${Prisma.join(filters, " AND ")}
    RETURNING "id"`;
  const ids = rows.map((row) => row.id);
  await markFailuresRetried({ sourceType: "notification_event", sourceIds: ids, operator });
  logger.warn("notification.dispatch.manual_retry", { operator, count: ids.length, eventType: retry.eventType ?? null, companyId: retry.companyId ?? null });
  return { count: ids.length, ids };
}

type EmailJob = { notificationId: string; memberId: string; variables: Record<string, string> };

async function dispatchOne(row: ClaimedRow): Promise<{ created: number; emailed: number }> {
  // A payload from a newer build, or an event type this build has never heard
  // of, is what a rolling deploy looks like from the old worker: refused
  // visibly, retried, and picked up by a worker that understands it (§224, §225).
  if (row.schemaVersion > OUTBOX_SCHEMA_VERSION) {
    throw new JobError("UNSUPPORTED_PAYLOAD", `outbox payload version ${row.schemaVersion} is newer than this worker reads (${OUTBOX_SCHEMA_VERSION})`);
  }
  const definition = findNotificationEvent(row.eventType);
  // An unregistered event type would produce a notification nobody can
  // interpret. Same rule as the audit registry.
  if (!definition) throw new JobError("UNSUPPORTED_PAYLOAD", `UNREGISTERED_NOTIFICATION_EVENT:${row.eventType}`);

  const event: OutboxEvent = { ...row, entityType: normaliseEntityType(row.entityType) };
  const payload = readPayload(event);
  const recordType = recordDefinition(event.entityType);
  // Every event is about a registered record; one that is not is refused
  // rather than delivered unchecked.
  if (!recordType) throw new JobError("UNSUPPORTED_PAYLOAD", `UNREGISTERED_NOTIFICATION_RECORD:${event.entityType}`);

  const candidates = [...new Set(await definition.recipients(prisma, event, payload))]
    .filter(Boolean)
    // Nobody is told about their own action (PRD #25 §39).
    .filter((memberId) => memberId !== event.actorMemberId);
  if (candidates.length === 0) return { created: 0, emailed: 0 };

  /*
   * A discussion message needs a discussion to take part in. A record type with
   * none tells nobody, and a confidential one (an HR record) tells only those
   * its thread admits — never everybody who can merely read the record
   * (PRD #38 §28, §30, PRD #47 §78).
   */
  if (definition.discussion && !recordType.collaboration) return { created: 0, emailed: 0 };
  const discussionPermissions = definition.discussion ? (recordType.collaboration?.requires ?? []) : [];

  const contexts = await buildMemberContexts(event.companyId, candidates);
  const permissions = [...[definition.permission?.(event, payload) ?? []].flat(), ...discussionPermissions];

  const entitled: string[] = [];
  let recordName: string | null = null;
  for (const [memberId, context] of contexts) {
    if (!permissions.every((permission) => can(context, permission))) continue;
    // The record, read as this member would read it, right now.
    const record = await loadRecord(context, event.entityType, event.entityId);
    if (!record) continue;
    recordName ??= record.label;
    entitled.push(memberId);
  }
  if (entitled.length === 0) return { created: 0, emailed: 0 };

  // Only members who can open the record are told, so naming it tells nobody
  // anything they could not already read.
  const copy = recordName && !payload.recordName ? { ...payload, recordName } : payload;
  const preferences = await deliveryPreferences(event.companyId, entitled, definition.category);
  const title = definition.title(copy).slice(0, 300);
  const body = definition.body?.(copy)?.slice(0, 1000) ?? null;

  const emailJobs: EmailJob[] = [];
  const pushEntries: QueuedNotification[] = [];
  let created = 0;

  for (const memberId of entitled) {
    const preference = preferences.get(memberId) ?? { inApp: true, email: false, push: true };
    if (!preference.inApp) continue;

    const dedupeKey = definition.dedupe(event, memberId, payload);
    let notificationId: string | null = null;
    try {
      const notification = await prisma.notification.create({
        data: {
          companyId: event.companyId,
          recipientMemberId: memberId,
          eventType: event.eventType,
          category: definition.category,
          moduleKey: recordType.moduleKey,
          title,
          body,
          priority: definition.priority,
          entityType: event.entityType,
          entityId: event.entityId,
          projectId: event.projectId,
          actorMemberId: event.actorMemberId,
          dedupeKey,
          // One record, one thread: related notifications collapse together (MOB-10 §96).
          threadKey: `${event.entityType}:${event.entityId}`.slice(0, 120),
          // The workflow's one id, carried from the command through its outbox
          // event and this worker attempt onto the row the recipient reads
          // (AUD-10 §8, gap 9). An id, never content.
          correlationId: currentRequestContext()?.correlationId ?? row.correlationId,
          // Where in the record it points — only ids, never content: the comment
          // (Activity Center §43), and which approval source the link opens where
          // the record type alone is ambiguous (AUD-10 §4, A7).
          ...linkMetadata(payload),
        },
        select: { id: true },
      });
      notificationId = notification.id;
      created += 1;
      // Only a notification written now is pushed now: a replayed event that hit the
      // dedupe key below was already queued on its first attempt.
      const userId = contexts.get(memberId)?.userId;
      if (userId) {
        pushEntries.push({
          notificationId: notification.id,
          companyId: event.companyId,
          userId,
          memberId,
          eventType: event.eventType,
          category: definition.category,
          priority: definition.priority,
          projectId: event.projectId,
          mandatory: Boolean(definition.mandatory),
          categoryPushEnabled: preference.push,
        });
      }
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      // Already delivered on an earlier attempt: the dedupe key held. If that
      // attempt died before its email went out, this one still sends it — the
      // mail's own idempotency key keeps it to one.
      const existing = await prisma.notification.findUnique({
        where: { companyId_recipientMemberId_dedupeKey: { companyId: event.companyId, recipientMemberId: memberId, dedupeKey } },
        select: { id: true, emailedAt: true },
      });
      if (!existing || existing.emailedAt) continue;
      notificationId = existing.id;
    }

    if (preference.email && definition.email && notificationId) {
      emailJobs.push({
        notificationId,
        memberId,
        variables: definition.email.variables(copy, appLink(`/notifications/${notificationId}/open`)),
      });
    }
  }

  // Push is queued after the rows exist and can never fail the event: the
  // in-app notification is the record, the phone is a courtesy (MOB-10 §110, §114).
  await queuePush(pushEntries).catch((error) => {
    logger.error("notification.push.queue_failed", { eventType: event.eventType, ...serialiseError(error) });
  });

  const emailed = await sendNotificationEmails(event, definition.email?.templateKey, emailJobs);
  return { created, emailed };
}

/**
 * The email copy of notifications that were just written. After the rows
 * exist, never inside a transaction, and idempotent per notification.
 */
async function sendNotificationEmails(
  event: OutboxEvent,
  templateKey: MailTemplateKey | undefined,
  jobs: EmailJob[],
): Promise<number> {
  // Email switched off for the deployment: in-app delivery is the whole job (PRD #51 §62, §63).
  if (!templateKey || jobs.length === 0 || !mailDeliveryEnabled()) return 0;

  const recipients = await prisma.companyMember.findMany({
    where: { id: { in: jobs.map((job) => job.memberId) }, companyId: event.companyId, status: "ACTIVE" },
    select: { id: true, user: { select: { email: true, status: true } } },
  });
  const emailByMember = new Map(
    recipients.filter((member) => member.user.status === "ACTIVE").map((member) => [member.id, member.user.email]),
  );

  let sent = 0;
  for (const job of jobs) {
    const to = emailByMember.get(job.memberId);
    if (!to) continue;
    const outcome = await sendMail({
      to,
      templateKey,
      variables: job.variables,
      idempotencyKey: `notification:${job.notificationId}`,
      companyId: event.companyId,
      entity: { type: "Notification", id: job.notificationId },
    });
    if (outcome.status === "SENT") {
      sent += 1;
      await prisma.notification.update({ where: { id: job.notificationId }, data: { emailedAt: new Date() } });
    }
  }
  return sent;
}

/** The ids a notification's link needs, and nothing else. */
function linkMetadata(payload: Record<string, unknown>): { metadataJson?: Prisma.InputJsonValue } {
  const metadata: Record<string, string> = {};
  if (typeof payload.commentId === "string") metadata.commentId = payload.commentId;
  if (typeof payload.providerKey === "string" && /^[a-z_]{1,32}$/.test(payload.providerKey)) metadata.providerKey = payload.providerKey;
  return Object.keys(metadata).length > 0 ? { metadataJson: metadata } : {};
}
