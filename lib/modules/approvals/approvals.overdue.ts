import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";

/**
 * Overdue approval reminders (PRD #41 §40, §163, §164, §228).
 *
 * Once a day, the people who could decide an approval past a real deadline
 * are reminded. Only sources with such a date take part — a review's due
 * date, leave's first day, a proposal's validity, a permit's start — and the
 * notification's dedupe key carries the day, so a scheduler running hourly
 * still reminds once per day. No generic escalation engine: whoever could
 * decide it hears about it, as the owning module already defines.
 */

const LIMIT = 500;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function remindOverdueApprovals(now = new Date()): Promise<{ enqueued: number }> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = isoDate(today);
  const [reviews, leave, proposals, permits] = await Promise.all([
    prisma.documentReview.findMany({
      where: { status: "PENDING", dueAt: { lt: today }, version: { document: { company: { status: "ACTIVE" } } } },
      select: { id: true, companyId: true, documentId: true, reviewerMemberId: true, dueAt: true },
      take: LIMIT,
    }),
    prisma.leaveRequest.findMany({ where: { status: "PENDING", startDate: { lt: today }, company: { status: "ACTIVE" } }, select: { id: true, companyId: true, startDate: true, companyMemberId: true }, take: LIMIT }),
    prisma.proposal.findMany({ where: { status: "PENDING_APPROVAL", validUntil: { lt: today }, company: { status: "ACTIVE" } }, select: { id: true, companyId: true, validUntil: true }, take: LIMIT }),
    prisma.hseWorkPermit.findMany({ where: { status: "PENDING_APPROVAL", validFrom: { lt: today }, company: { status: "ACTIVE" } }, select: { id: true, companyId: true, projectId: true, validFrom: true }, take: LIMIT }),
  ]);

  const events = [
    ...reviews.map((row) => ({ companyId: row.companyId, moduleKey: "documents", entityType: "document", entityId: row.documentId, projectId: null as string | null, payload: { approvalKey: `documents:${row.id}`, dueDate: isoDate(row.dueAt!), approverMemberIds: [row.reviewerMemberId], recordLabel: "A document review", day } })),
    ...leave.map((row) => ({ companyId: row.companyId, moduleKey: "hr", entityType: "leave_request", entityId: row.id, projectId: null, payload: { approvalKey: `hr:${row.id}`, dueDate: isoDate(row.startDate), approvePermissions: ["hr.leave.approve"], excludeMemberIds: [row.companyMemberId], recordLabel: "A leave request", day } })),
    ...proposals.map((row) => ({ companyId: row.companyId, moduleKey: "sales", entityType: "proposal", entityId: row.id, projectId: null, payload: { approvalKey: `sales:${row.id}`, dueDate: isoDate(row.validUntil!), approvePermissions: ["sales.proposal.approve"], recordLabel: "A proposal", day } })),
    ...permits.map((row) => ({ companyId: row.companyId, moduleKey: "hse", entityType: "work_permit", entityId: row.id, projectId: row.projectId, payload: { approvalKey: `hse:${row.id}`, dueDate: isoDate(row.validFrom), approvePermissions: ["hse.permit.approve"], recordLabel: "A work permit", day } })),
  ];

  // One outbox row per approval per day: a rerun the same day adds nothing.
  const already = await prisma.notificationEventOutbox.findMany({
    where: { eventType: NotificationEvent.APPROVAL_OVERDUE, createdAt: { gte: today } },
    select: { entityType: true, entityId: true },
  });
  const sent = new Set(already.map((row) => `${row.entityType}:${row.entityId}`));
  let enqueued = 0;
  for (const event of events) {
    if (sent.has(`${event.entityType}:${event.entityId}`)) continue;
    await prisma.$transaction((tx) =>
      enqueueNotificationEvent(tx, {
        companyId: event.companyId,
        eventType: NotificationEvent.APPROVAL_OVERDUE,
        moduleKey: event.moduleKey,
        entityType: event.entityType,
        entityId: event.entityId,
        actorMemberId: null,
        projectId: event.projectId,
        payload: event.payload,
      }),
    );
    sent.add(`${event.entityType}:${event.entityId}`);
    enqueued += 1;
  }
  if (enqueued > 0) incrementCounter(Metric.APPROVAL_OVERDUE, {}, enqueued);
  return { enqueued };
}
