import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { currentRequestContext } from "@/lib/core/observability/request-context";
import { loadRecord } from "@/lib/core/records/record.registry";
import { normaliseEntityType } from "./notification.dispatch";

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
  category: string | null;
  /** The re-authorising open route, never the record URL itself. */
  href: string | null;
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

export type NotificationPage = {
  data: NotificationListItemDTO[];
  /** Pass as `before` to load the next, older page. */
  nextBefore: string | null;
};

/**
 * The reader's own notifications, newest first, by cursor (PRD #38 §72, §152).
 *
 * Every link goes through `/notifications/:id/open`, which re-authorises the
 * record at the moment it is followed: a notification is a message about the
 * past, never a key to the present (PRD #38 §82).
 */
export async function listNotifications(
  context: UserContext,
  options: { readState?: "UNREAD" | "READ"; before?: string; limit?: number } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  let anchor: { createdAt: Date; id: string } | null = null;
  if (options.before) {
    anchor = await prisma.notification.findFirst({
      where: { id: options.before, companyId: context.companyId, recipientMemberId: context.membershipId },
      select: { createdAt: true, id: true },
    });
  }

  const rows = await prisma.notification.findMany({
    where: {
      // Both, always: a notification belongs to one member in one company.
      companyId: context.companyId,
      recipientMemberId: context.membershipId,
      ...(options.readState ? { readState: options.readState } : {}),
      ...(anchor
        ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  return {
    data: page.map(
      (row): NotificationListItemDTO => ({
        id: row.id,
        eventType: row.eventType,
        category: row.category,
        moduleKey: row.moduleKey,
        title: row.title,
        body: row.body,
        priority: row.priority,
        readState: row.readState,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
        href: row.entityType && row.entityId ? `/notifications/${row.id}/open` : null,
      }),
    ),
    nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

export type OpenedNotification = { href: string } | { unavailable: true };

/**
 * Follows a notification's link (PRD #38 §82).
 *
 * The notification must be the reader's own — another member's id is simply
 * not found — and the record behind it is read again, now, through the record
 * registry. If access has gone, the answer is "unavailable" and nothing about
 * the record is revealed, not even its name.
 */
export async function openNotification(context: UserContext, id: string): Promise<OpenedNotification> {
  const notification = await prisma.notification.findFirst({
    where: { id, companyId: context.companyId, recipientMemberId: context.membershipId },
    select: { id: true, entityType: true, entityId: true, readState: true },
  });
  if (!notification) throw new AccessError("NOT_FOUND");

  if (notification.readState === "UNREAD") {
    await prisma.notification.update({ where: { id: notification.id }, data: { readState: "READ", readAt: new Date() } });
  }

  if (!notification.entityType || !notification.entityId) return { unavailable: true };
  const record = await loadRecord(context, normaliseEntityType(notification.entityType), notification.entityId);
  return record ? { href: record.href } : { unavailable: true };
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
