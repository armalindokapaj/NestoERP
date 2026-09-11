import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { currentRequestContext } from "@/lib/core/observability/request-context";

/**
 * Notifications (PRD #25 §145-§158).
 *
 * Recipients are resolved server-side and every one is re-checked for active
 * membership, module access, permission and scope before a row is written — a
 * notification must never tell somebody something they could not otherwise see
 * (PRD #25 §37, §42, §49).
 */

export type NotificationListItemDTO = {
  id: string;
  eventType: string;
  moduleKey: string;
  title: string;
  body: string | null;
  priority: string;
  readState: string;
  createdAt: string;
  readAt: string | null;
  entity: { entityType: string; entityId: string; href: string | null } | null;
};

export type UnreadCountDTO = {
  unread: number;
  criticalUnread: number;
  activeAttention: number;
  criticalAttention: number;
};

/**
 * Enqueues a domain event for notification processing, inside the caller's
 * transaction. Nothing is delivered for a mutation that rolls back
 * (PRD #25 §25, §240).
 */
export async function enqueueNotificationEvent(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    eventType: string;
    moduleKey: string;
    entityType: string;
    entityId: string;
    actorMemberId?: string | null;
    projectId?: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.notificationEventOutbox.create({
    data: {
      companyId: input.companyId,
      eventType: input.eventType,
      moduleKey: input.moduleKey,
      entityType: input.entityType,
      entityId: input.entityId,
      actorMemberId: input.actorMemberId ?? null,
      projectId: input.projectId ?? null,
      payloadJson: input.payload as Prisma.InputJsonValue,
      correlationId: currentRequestContext()?.correlationId ?? null,
      nextAttemptAt: new Date(),
    },
  });
}

/**
 * Creates a notification for one recipient, idempotently.
 *
 * The dedupe key is what makes outbox retries safe: processing the same event
 * twice produces one notification (PRD #25 §230).
 */
export async function createNotification(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    recipientMemberId: string;
    eventType: string;
    moduleKey: string;
    title: string;
    body?: string | null;
    priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
    entityType?: string | null;
    entityId?: string | null;
    projectId?: string | null;
    actorMemberId?: string | null;
    dedupeKey: string;
    correlationId?: string | null;
  },
): Promise<void> {
  const existing = await tx.notification.findFirst({
    where: { companyId: input.companyId, dedupeKey: input.dedupeKey },
    select: { id: true },
  });
  if (existing) return;

  await tx.notification.create({
    data: {
      companyId: input.companyId,
      recipientMemberId: input.recipientMemberId,
      eventType: input.eventType,
      moduleKey: input.moduleKey,
      title: input.title,
      body: input.body ?? null,
      priority: input.priority ?? "NORMAL",
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      projectId: input.projectId ?? null,
      actorMemberId: input.actorMemberId ?? null,
      dedupeKey: input.dedupeKey,
      correlationId: input.correlationId ?? null,
    },
  });
}

export async function listNotifications(
  context: UserContext,
  options: { readState?: "UNREAD" | "READ"; page?: number; limit?: number } = {},
) {
  const limit = Math.min(options.limit ?? 25, 100);
  const page = Math.max(options.page ?? 1, 1);

  const where: Prisma.NotificationWhereInput = {
    // Both, always: a notification belongs to one member in one company.
    companyId: context.companyId,
    recipientMemberId: context.membershipId,
    ...(options.readState ? { readState: options.readState } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    data: rows.map(
      (row): NotificationListItemDTO => ({
        id: row.id,
        eventType: row.eventType,
        moduleKey: row.moduleKey,
        title: row.title,
        body: row.body,
        priority: row.priority,
        readState: row.readState,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
        entity:
          row.entityType && row.entityId
            ? {
                entityType: row.entityType,
                entityId: row.entityId,
                // Resolved at read time: permissions may have changed since the
                // notification was written (PRD #25 §46, §47).
                href: resolveHref(context, row.moduleKey, row.entityType, row.entityId),
              }
            : null,
      }),
    ),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** A link only exists while the module is on and the reader still has access. */
function resolveHref(
  context: UserContext,
  moduleKey: string,
  entityType: string,
  entityId: string,
): string | null {
  const access = context.moduleAccess[moduleKey as keyof typeof context.moduleAccess];
  if (!access?.enabled) return null;

  const routes: Record<string, string> = {
    task: `/tasks/${entityId}`,
    project: `/projects/${entityId}`,
    client: `/clients/${entityId}`,
    invoice: `/finance/invoices/${entityId}`,
    expense: `/finance/expenses/${entityId}`,
    document: `/documents/${entityId}`,
  };
  return routes[entityType] ?? null;
}

export async function getUnreadCount(context: UserContext): Promise<UnreadCountDTO> {
  const [unread, criticalUnread, activeAttention, criticalAttention] = await Promise.all([
    prisma.notification.count({
      where: { companyId: context.companyId, recipientMemberId: context.membershipId, readState: "UNREAD" },
    }),
    prisma.notification.count({
      where: {
        companyId: context.companyId,
        recipientMemberId: context.membershipId,
        readState: "UNREAD",
        priority: "CRITICAL",
      },
    }),
    prisma.attentionItem.count({
      where: { companyId: context.companyId, recipientMemberId: context.membershipId, status: "ACTIVE" },
    }),
    prisma.attentionItem.count({
      where: {
        companyId: context.companyId,
        recipientMemberId: context.membershipId,
        status: "ACTIVE",
        priority: "CRITICAL",
      },
    }),
  ]);

  return { unread, criticalUnread, activeAttention, criticalAttention };
}

/** Only the recipient may change their own read state (PRD #25 §157, §165). */
export async function markRead(context: UserContext, id: string, read: boolean): Promise<void> {
  const result = await prisma.notification.updateMany({
    where: { id, companyId: context.companyId, recipientMemberId: context.membershipId },
    data: { readState: read ? "READ" : "UNREAD", readAt: read ? new Date() : null },
  });
  // Somebody else's notification is simply not found (PRD #25 §165).
  if (result.count === 0) throw new AccessError("NOT_FOUND");
}

export async function markAllRead(context: UserContext): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { companyId: context.companyId, recipientMemberId: context.membershipId, readState: "UNREAD" },
    data: { readState: "READ", readAt: new Date() },
  });
  return result.count;
}
