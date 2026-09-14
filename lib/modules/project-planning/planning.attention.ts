import type { Prisma } from "@prisma/client";

import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { dateLabel, dateOf, isClosed, localDate, targetDateOf } from "./planning.dates";
import { MODULE, RECORD } from "./planning.permissions";
import { resolvePlanningSettings } from "./planning.settings";

/**
 * What planning tells people, and what it asks them to look at (PRD #44 §70-§74,
 * §157, §164-§168, §215, §250-§253).
 *
 * Notifications are events in the outbox, written in the same transaction as
 * the change; the dispatcher re-reads the milestone in each recipient's own
 * context, so nobody hears about a plan they cannot open. Attention is a
 * condition that holds right now — overdue, at risk, critically blocked — and
 * is resolved the moment a change ends it.
 */

type Tx = Prisma.TransactionClient;

export type MilestoneRef = { id: string; companyId: string; projectId: string; name: string; ownerMemberId: string | null; critical: boolean; externallyCommitted: boolean };

/** Only a running project nags: a draft, paused, completed or archived one keeps its plan quietly (§273). */
const ACTIVE_PROJECT = { archivedAt: null, status: "ACTIVE" as const };
const OPEN_MILESTONE = { archivedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] as Array<"COMPLETED" | "CANCELLED"> } };

/** The CEO and Owner, when the company asked for them to hear about critical committed milestones (§165, §253). */
export async function executiveMemberIds(tx: Tx | typeof prisma, companyId: string): Promise<string[]> {
  const rows = await tx.companyMember.findMany({ where: { companyId, status: "ACTIVE", role: { key: { in: ["OWNER", "CEO"] } } }, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function notifyMilestone(
  tx: Tx,
  input: { eventType: string; milestone: MilestoneRef; projectName: string; actorMemberId: string | null; memberIds: Array<string | null | undefined>; payload?: Record<string, unknown> },
) {
  const memberIds = [...new Set(input.memberIds.filter((id): id is string => Boolean(id)))];
  if (!memberIds.length) return;
  await enqueueNotificationEvent(tx, {
    companyId: input.milestone.companyId,
    eventType: input.eventType,
    moduleKey: MODULE,
    entityType: RECORD,
    entityId: input.milestone.id,
    actorMemberId: input.actorMemberId,
    projectId: input.milestone.projectId,
    payload: { memberIds, milestoneName: input.milestone.name, projectName: input.projectName, critical: input.milestone.critical ? "yes" : "", ...input.payload },
  });
}

/* -------------------------------------------------------------------------- */
/* Attention                                                                   */
/* -------------------------------------------------------------------------- */

export const PLANNING_CONDITIONS = ["MILESTONE_OVERDUE", "MILESTONE_AT_RISK", "CRITICAL_MILESTONE_BLOCKED"] as const;
const LIMIT = 500;

const ROW_SELECT = {
  id: true,
  projectId: true,
  name: true,
  status: true,
  ownerMemberId: true,
  baselineDate: true,
  plannedDate: true,
  forecastDate: true,
  critical: true,
  externallyCommitted: true,
  statusChangedAt: true,
  createdAt: true,
  project: { select: { name: true, projectManagerMemberId: true } },
} satisfies Prisma.ProjectMilestoneSelect;

export type PlanningAttentionRow = Prisma.ProjectMilestoneGetPayload<{ select: typeof ROW_SELECT }> & { target: string | null; today: string };

async function todayFor(companyId: string, now: Date) {
  const settings = await resolvePlanningSettings(companyId);
  return localDate(now, settings.timezone);
}

/** Open milestones on live projects whose target date has passed (§44, §72). */
export async function overdueMilestones(companyId: string, now: Date, milestoneId?: string): Promise<PlanningAttentionRow[]> {
  const today = await todayFor(companyId, now);
  const before = new Date(`${today}T00:00:00.000Z`);
  const rows = await prisma.projectMilestone.findMany({
    where: {
      companyId,
      ...OPEN_MILESTONE,
      ...(milestoneId ? { id: milestoneId } : {}),
      project: { is: ACTIVE_PROJECT },
      OR: [{ forecastDate: { lt: before } }, { forecastDate: null, plannedDate: { lt: before } }, { forecastDate: null, plannedDate: null, baselineDate: { lt: before } }],
    },
    orderBy: { forecastDate: "asc" },
    take: LIMIT,
    select: ROW_SELECT,
  });
  return rows
    .map((row) => ({ ...row, target: targetDateOf({ baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate) }), today }))
    .filter((row) => !isClosed(row.status) && row.target !== null && row.target < today);
}

/** Milestones somebody marked at risk (§43, §72): the flag is manual, never guessed. */
export async function atRiskMilestones(companyId: string, milestoneId?: string): Promise<PlanningAttentionRow[]> {
  const rows = await prisma.projectMilestone.findMany({
    where: { companyId, archivedAt: null, status: "AT_RISK", ...(milestoneId ? { id: milestoneId } : {}), project: { is: ACTIVE_PROJECT } },
    take: LIMIT,
    select: ROW_SELECT,
  });
  return rows.map((row) => ({ ...row, target: targetDateOf({ baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate) }), today: "" }));
}

/** Open critical blockers on milestones still to be achieved (§157). */
export async function criticallyBlockedMilestones(companyId: string, milestoneId?: string) {
  const blockers = await prisma.projectMilestoneBlocker.findMany({
    where: { companyId, severity: "CRITICAL", resolvedAt: null, ...(milestoneId ? { milestoneId } : {}), milestone: { is: { ...OPEN_MILESTONE, project: { is: ACTIVE_PROJECT } } } },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
    select: { id: true, title: true, ownerMemberId: true, milestone: { select: ROW_SELECT } },
  });
  const byMilestone = new Map<string, { milestone: (typeof blockers)[number]["milestone"]; first: (typeof blockers)[number]; owners: string[]; count: number }>();
  for (const blocker of blockers) {
    const entry = byMilestone.get(blocker.milestone.id) ?? { milestone: blocker.milestone, first: blocker, owners: [], count: 0 };
    entry.count += 1;
    if (blocker.ownerMemberId) entry.owners.push(blocker.ownerMemberId);
    byMilestone.set(blocker.milestone.id, entry);
  }
  return [...byMilestone.values()];
}

/**
 * Ends, straight away, whatever a change stopped being true (§73): completed,
 * cancelled, re-forecast, no longer at risk, blocker resolved. The scheduled
 * reconciliation would get there too.
 */
export async function settleMilestoneAttention(companyId: string, milestoneId: string, now = new Date()) {
  const [overdue, atRisk, blocked] = await Promise.all([overdueMilestones(companyId, now, milestoneId), atRiskMilestones(companyId, milestoneId), criticallyBlockedMilestones(companyId, milestoneId)]);
  const ended = [!overdue.length && "MILESTONE_OVERDUE", !atRisk.length && "MILESTONE_AT_RISK", !blocked.length && "CRITICAL_MILESTONE_BLOCKED"].filter((key): key is string => Boolean(key));
  if (ended.length) await resolveAttentionForRecord(prisma, companyId, RECORD, milestoneId, ended);
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Due-soon and overdue reminders (job `planning.milestones`, §71, §166, §167,
 * §251, §252). Each is sent once per milestone per target date: moving the
 * forecast starts a new reminder, running the job again does not.
 */
export async function runMilestoneReminders(now = new Date()): Promise<{ dueSoon: number; overdue: number }> {
  const companies = await prisma.company.findMany({ where: { status: "ACTIVE", modules: { some: { enabled: true, module: { key: MODULE } } } }, select: { id: true } });
  let dueSoon = 0;
  let overdue = 0;
  for (const company of companies) {
    const settings = await resolvePlanningSettings(company.id);
    const today = localDate(now, settings.timezone);
    const horizon = new Date(`${today}T12:00:00.000Z`);
    horizon.setUTCDate(horizon.getUTCDate() + settings.milestoneReminderDays);
    const executives = settings.notifyExecutivesOnCriticalChanges ? await executiveMemberIds(prisma, company.id) : [];

    const soon = await prisma.projectMilestone.findMany({
      where: { companyId: company.id, ...OPEN_MILESTONE, project: { is: ACTIVE_PROJECT }, OR: [{ forecastDate: { gte: new Date(`${today}T00:00:00.000Z`), lte: horizon } }, { forecastDate: null, plannedDate: { gte: new Date(`${today}T00:00:00.000Z`), lte: horizon } }] },
      take: 2_000,
      select: ROW_SELECT,
    });
    const late = await overdueMilestones(company.id, now);

    for (const [kind, rows] of [["due", soon], ["overdue", late]] as const) {
      for (const row of rows) {
        const target = targetDateOf({ baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate) });
        if (!target) continue;
        const eventType = kind === "due" ? NotificationEvent.MILESTONE_DUE_SOON : NotificationEvent.MILESTONE_OVERDUE;
        const already = await prisma.notificationEventOutbox.count({ where: { companyId: company.id, eventType, entityType: RECORD, entityId: row.id, payloadJson: { path: ["targetDate"], equals: target } } });
        if (already) continue;
        // Due soon goes to the owner, and to the project manager for a critical milestone; overdue to both (§251, §252).
        const memberIds = kind === "due" ? [row.ownerMemberId ?? row.project.projectManagerMemberId, row.critical ? row.project.projectManagerMemberId : null] : [row.ownerMemberId, row.project.projectManagerMemberId, ...(row.critical && row.externallyCommitted ? executives : [])];
        await prisma.$transaction((tx) =>
          notifyMilestone(tx, {
            eventType,
            milestone: { id: row.id, companyId: company.id, projectId: row.projectId, name: row.name, ownerMemberId: row.ownerMemberId, critical: row.critical, externallyCommitted: row.externallyCommitted },
            projectName: row.project.name,
            actorMemberId: null,
            memberIds,
            payload: { targetDate: target, dateLabel: dateLabel(target) },
          }),
        );
        if (kind === "due") dueSoon += 1;
        else overdue += 1;
      }
    }
  }
  if (overdue) incrementCounter(Metric.MILESTONE_OVERDUE, {}, overdue);
  return { dueSoon, overdue };
}
