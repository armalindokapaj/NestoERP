import { prisma } from "@/lib/database/prisma";
import { startOfDay } from "./attention.conditions";
import { NotificationEvent } from "./notification.events";
import { enqueueNotificationEvent } from "./notification.service";

/**
 * Date-driven notifications (PRD #38 §50, §74).
 *
 * Nothing happens at midnight that a producer could announce, so a scheduled
 * sweep does it: tasks that became overdue since the last sweep, and contract
 * obligations that came within a week of their due date. The window runs from
 * the previous successful sweep to now, so a worker that was down for a day
 * catches up instead of skipping it, and each notification's dedupe key (per
 * due date) makes an overlapping window harmless.
 */

const DAY_MS = 86_400_000;
const OBLIGATION_NOTICE_DAYS = 7;
const BATCH = 500;

export type DueEventsResult = { tasksOverdue: number; obligationsDue: number };

export async function enqueueDueNotifications(options: { now?: Date; since?: Date | null } = {}): Promise<DueEventsResult> {
  const now = options.now ?? new Date();
  const today = startOfDay(now);
  // First run: only what became due in the last day, not the whole backlog.
  const from = startOfDay(options.since ?? new Date(now.getTime() - DAY_MS));
  const overdueFrom = new Date(from.getTime() - DAY_MS);

  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      assigneeMemberId: { not: null },
      dueDate: { gte: overdueFrom, lt: today },
      company: { status: "ACTIVE" },
    },
    select: { id: true, companyId: true, title: true, projectId: true, dueDate: true, assigneeMemberId: true },
    take: BATCH,
  });

  const noticeFrom = new Date(from.getTime() + OBLIGATION_NOTICE_DAYS * DAY_MS);
  const noticeUntil = new Date(today.getTime() + (OBLIGATION_NOTICE_DAYS + 1) * DAY_MS);
  const obligations = await prisma.contractObligation.findMany({
    where: {
      status: "OPEN",
      dueDate: { gte: noticeFrom, lt: noticeUntil },
      contract: { archivedAt: null, company: { status: "ACTIVE" } },
    },
    select: {
      id: true,
      companyId: true,
      title: true,
      dueDate: true,
      responsibleMemberId: true,
      contract: { select: { contractNumber: true, title: true, ownerMemberId: true, projectId: true } },
    },
    take: BATCH,
  });

  await prisma.$transaction(async (tx) => {
    for (const task of tasks) {
      await enqueueNotificationEvent(tx, {
        companyId: task.companyId,
        eventType: NotificationEvent.TASK_OVERDUE,
        moduleKey: "tasks",
        entityType: "task",
        entityId: task.id,
        projectId: task.projectId,
        payload: { title: task.title, dueDate: task.dueDate!.toISOString().slice(0, 10), assigneeMemberId: task.assigneeMemberId },
      });
    }
    for (const obligation of obligations) {
      await enqueueNotificationEvent(tx, {
        companyId: obligation.companyId,
        eventType: NotificationEvent.CONTRACT_OBLIGATION_DUE,
        moduleKey: "contracts",
        entityType: "obligation",
        entityId: obligation.id,
        projectId: obligation.contract.projectId,
        payload: {
          title: obligation.title,
          dueDate: obligation.dueDate!.toISOString().slice(0, 10),
          responsibleMemberId: obligation.responsibleMemberId,
          contractOwnerMemberId: obligation.contract.ownerMemberId,
          contractLabel: `${obligation.contract.contractNumber} · ${obligation.contract.title}`,
        },
      });
    }
  });

  return { tasksOverdue: tasks.length, obligationsDue: obligations.length };
}
