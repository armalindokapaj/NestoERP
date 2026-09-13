import { can, canAccessModule } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { resolveRecipientAccess } from "./notification.access";
import { createNotification } from "./notification.service";
import { findNotificationEvent, type OutboxEvent } from "./notification.events";

/**
 * The outbox dispatcher (PRD #25 §25, §230-§245).
 *
 * Producers enqueue an event inside their own transaction, so nothing is ever
 * delivered for a mutation that rolled back. This drains that outbox and turns
 * each event into notifications for the people entitled to hear about it.
 *
 * Delivery is where entitlement is decided, not where the event was produced.
 * Between the two, a member can be suspended, lose a role, or have their
 * company switch the module off — so every recipient is re-checked here
 * against live access, and a candidate who no longer qualifies is dropped
 * silently rather than told (PRD #25 §37, §42, §49).
 *
 * Failure is per event: one malformed payload must not stop the queue. An
 * event that fails is retried with backoff and gives up after MAX_ATTEMPTS
 * rather than being retried forever (PRD #25 §243).
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [30, 120, 600, 3600];

export type DispatchResult = {
  processed: number;
  notificationsCreated: number;
  failed: number;
};

function backoffFor(attempt: number): Date {
  const seconds = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
  return new Date(Date.now() + seconds * 1000);
}

export async function dispatchNotifications(limit = 100): Promise<DispatchResult> {
  const due = await prisma.notificationEventOutbox.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const result: DispatchResult = { processed: 0, notificationsCreated: 0, failed: 0 };

  for (const row of due) {
    try {
      result.notificationsCreated += await dispatchOne(row as OutboxEvent);
      await prisma.notificationEventOutbox.update({
        where: { id: row.id },
        data: { status: "PROCESSED", processedAt: new Date(), lastError: null },
      });
      result.processed += 1;
    } catch (error) {
      const attempt = row.attemptCount + 1;
      const exhausted = attempt >= MAX_ATTEMPTS;

      await prisma.notificationEventOutbox.update({
        where: { id: row.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attemptCount: attempt,
          nextAttemptAt: exhausted ? null : backoffFor(attempt),
          lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown",
        },
      });

      logger.error("notification.dispatch.failed", {
        outboxId: row.id,
        eventType: row.eventType,
        attempt,
        ...serialiseError(error),
      });
      result.failed += 1;
    }
  }

  return result;
}

/** Returns how many notification rows this event produced. */
async function dispatchOne(event: OutboxEvent): Promise<number> {
  const definition = findNotificationEvent(event.eventType);

  // An unregistered event type would produce a notification nobody can
  // interpret. Same rule as the audit registry.
  if (!definition) throw new Error(`UNREGISTERED_NOTIFICATION_EVENT:${event.eventType}`);

  const payload =
    event.payloadJson && typeof event.payloadJson === "object"
      ? (event.payloadJson as Record<string, unknown>)
      : {};

  return prisma.$transaction(async (tx) => {
    const candidates = await definition.recipients(tx, event, payload);

    // Nobody is told about their own action (PRD #25 §39).
    const withoutActor = candidates.filter((id) => id !== event.actorMemberId);
    if (withoutActor.length === 0) return 0;

    const access = await resolveRecipientAccess(event.companyId, withoutActor);

    const title = definition.title(payload);
    const body = definition.body?.(payload) ?? null;
    let created = 0;

    for (const memberId of withoutActor) {
      const holder = access.get(memberId);
      // Not an active member of this company any more.
      if (!holder) continue;
      // The module was switched off, or they never had it.
      if (!canAccessModule(holder, definition.moduleKey)) continue;
      // The permission that justifies hearing about this at all.
      if (!can(holder, definition.permission)) continue;

      await createNotification(tx, {
        companyId: event.companyId,
        recipientMemberId: memberId,
        eventType: event.eventType,
        moduleKey: definition.moduleKey,
        title,
        body,
        priority: definition.priority,
        entityType: event.entityType,
        entityId: event.entityId,
        projectId: event.projectId,
        actorMemberId: event.actorMemberId,
        // One notification per person per event, however many times the outbox
        // retries this row (PRD #25 §230).
        dedupeKey: `${event.id}:${memberId}`,
      });
      created += 1;
    }

    return created;
  });
}
