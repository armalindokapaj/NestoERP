import { hostname } from "node:os";

import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { appLink } from "@/lib/config/app-url";
import { buildMemberContexts } from "@/lib/context/member-context";
import { prisma } from "@/lib/database/prisma";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import { sendMail } from "@/lib/mail";
import type { MailTemplateKey } from "@/lib/mail/mail.types";
import { findNotificationEvent, readPayload, type OutboxEvent } from "./notification.events";
import { deliveryPreferences } from "./notification.preferences";

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
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [30, 120, 600, 3600];
const LEASE_SECONDS = 120;

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

function backoffFor(attempt: number): Date {
  const seconds = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
  return new Date(Date.now() + seconds * 1000);
}

export function workerIdentity(): string {
  return `${hostname()}:${process.pid}`;
}

type ClaimedRow = OutboxEvent & { attemptCount: number };

/** Claims up to `limit` due events for this worker. Expired leases are due again. */
export async function claimOutboxBatch(limit: number, workerId: string): Promise<ClaimedRow[]> {
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "notification_event_outbox" AS o
    SET "status" = 'PROCESSING',
        "lockedAt" = now(),
        "lockedBy" = ${workerId},
        "leaseExpiresAt" = now() + (${LEASE_SECONDS} * interval '1 second'),
        "updatedAt" = now()
    WHERE o."id" IN (
      SELECT "id" FROM "notification_event_outbox"
      WHERE ("status" = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()))
         OR ("status" = 'PROCESSING' AND "leaseExpiresAt" < now())
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o."id", o."companyId", o."eventType", o."moduleKey", o."entityType", o."entityId",
              o."actorMemberId", o."projectId", o."payloadJson", o."attemptCount"`;
}

export async function dispatchNotifications(limit = 100, workerId = workerIdentity()): Promise<DispatchResult> {
  const result: DispatchResult = { processed: 0, notificationsCreated: 0, emailsSent: 0, failed: 0 };
  const batch = await claimOutboxBatch(limit, workerId);

  for (const row of batch) {
    try {
      const outcome = await dispatchOne(row);
      // Settled only by the lease holder: a row whose lease expired and was
      // re-claimed belongs to the other worker now.
      await prisma.notificationEventOutbox.updateMany({
        where: { id: row.id, lockedBy: workerId, status: "PROCESSING" },
        data: { status: "PROCESSED", processedAt: new Date(), lastError: null, lockedAt: null, lockedBy: null, leaseExpiresAt: null },
      });
      result.processed += 1;
      result.notificationsCreated += outcome.created;
      result.emailsSent += outcome.emailed;
      incrementCounter(Metric.NOTIFICATION_DISPATCH_SUCCESS, { event: row.eventType });
    } catch (error) {
      const attempt = row.attemptCount + 1;
      const exhausted = attempt >= MAX_ATTEMPTS;
      await prisma.notificationEventOutbox.updateMany({
        where: { id: row.id, lockedBy: workerId },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attemptCount: attempt,
          nextAttemptAt: exhausted ? null : backoffFor(attempt),
          lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
        },
      });
      incrementCounter(Metric.NOTIFICATION_DISPATCH_FAILURE, { event: row.eventType });
      logger.error("notification.dispatch.failed", { outboxId: row.id, eventType: row.eventType, attempt, exhausted, ...serialiseError(error) });
      result.failed += 1;
    }
  }

  return result;
}

/** Returns failed events to the queue for another full set of attempts (PRD #38 §81). */
export async function retryFailedNotificationEvents(options: { ids?: string[]; eventType?: string } = {}): Promise<number> {
  const result = await prisma.notificationEventOutbox.updateMany({
    where: {
      status: "FAILED",
      ...(options.ids?.length ? { id: { in: options.ids } } : {}),
      ...(options.eventType ? { eventType: options.eventType } : {}),
    },
    data: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), lastError: null },
  });
  return result.count;
}

type EmailJob = { notificationId: string; memberId: string; variables: Record<string, string> };

async function dispatchOne(row: ClaimedRow): Promise<{ created: number; emailed: number }> {
  const definition = findNotificationEvent(row.eventType);
  // An unregistered event type would produce a notification nobody can
  // interpret. Same rule as the audit registry.
  if (!definition) throw new Error(`UNREGISTERED_NOTIFICATION_EVENT:${row.eventType}`);

  const event: OutboxEvent = { ...row, entityType: normaliseEntityType(row.entityType) };
  const payload = readPayload(event);
  const recordType = recordDefinition(event.entityType);
  // Every event is about a registered record; one that is not is refused
  // rather than delivered unchecked.
  if (!recordType) throw new Error(`UNREGISTERED_NOTIFICATION_RECORD:${event.entityType}`);

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
  let created = 0;

  for (const memberId of entitled) {
    const preference = preferences.get(memberId) ?? { inApp: true, email: false };
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
        },
        select: { id: true },
      });
      notificationId = notification.id;
      created += 1;
    } catch (error) {
      // Already delivered on an earlier attempt: the dedupe key held.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }

    if (preference.email && definition.email && notificationId) {
      emailJobs.push({
        notificationId,
        memberId,
        variables: definition.email.variables(copy, appLink(`/notifications/${notificationId}/open`)),
      });
    }
  }

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
  if (!templateKey || jobs.length === 0) return 0;

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
