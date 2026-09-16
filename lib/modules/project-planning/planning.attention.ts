import type { Prisma } from "@prisma/client";

import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import type { AttentionRowPage, AttentionRows } from "@/lib/core/notifications/attention.conditions";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays, dateLabel, dateOf, isClosed, localDate, targetDateOf } from "./planning.dates";
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

/**
 * The CEO and Owner, when the company asked for them to hear about critical
 * committed milestones (§165, §253). Recipient targeting by role key, not
 * authorization: the dispatcher re-reads the milestone in each recipient's own
 * context before anything is delivered (PRD #47 §32).
 */
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

const startOf = (date: string) => new Date(`${date}T00:00:00.000Z`);
const endOf = (date: string) => new Date(`${date}T23:59:59.999Z`);

/**
 * Milestones whose target date — the forecast, else the planned date, else the
 * baseline (`targetDateOf`) — falls in a range. Every branch is needed: a
 * milestone with only a baseline is as due as one with a forecast.
 */
const targetIn = (range: Prisma.DateTimeNullableFilter): Prisma.ProjectMilestoneWhereInput[] => [
  { forecastDate: range },
  { forecastDate: null, plannedDate: range },
  { forecastDate: null, plannedDate: null, baselineDate: range },
];

/** Open milestones on live projects whose target date has passed (§44, §72). */
export async function overdueMilestones(companyId: string, now: Date, milestoneId?: string): Promise<PlanningAttentionRow[]> {
  const today = await todayFor(companyId, now);
  const rows = await prisma.projectMilestone.findMany({
    where: { ...overdueWhere(companyId, today), ...(milestoneId ? { id: milestoneId } : {}) },
    orderBy: [{ forecastDate: "asc" }, { id: "asc" }],
    take: LIMIT,
    select: ROW_SELECT,
  });
  return overdueOf(rows, today);
}

/**
 * Overdue milestones a page at a time by id, and where the next page starts,
 * so the attention reconciler walks every one of them (PRD #51 §133-§135). The
 * cursor follows the rows read rather than the rows kept.
 */
export async function overdueMilestonePage(companyId: string, now: Date, page: AttentionRowPage): Promise<AttentionRows<PlanningAttentionRow>> {
  const today = await todayFor(companyId, now);
  const rows = await prisma.projectMilestone.findMany({
    where: { ...overdueWhere(companyId, today), ...(page.after ? { id: { gt: page.after } } : {}) },
    orderBy: { id: "asc" },
    take: page.take,
    select: ROW_SELECT,
  });
  return { rows: overdueOf(rows, today), next: rows.length === page.take ? rows[rows.length - 1].id : null };
}

const overdueWhere = (companyId: string, today: string): Prisma.ProjectMilestoneWhereInput => ({ companyId, ...OPEN_MILESTONE, project: { is: ACTIVE_PROJECT }, OR: targetIn({ lt: startOf(today) }) });

function overdueOf(rows: MilestoneRow[], today: string): PlanningAttentionRow[] {
  return rows
    .map((row) => ({ ...row, target: targetDateOf({ baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate) }), today }))
    .filter((row) => !isClosed(row.status) && row.target !== null && row.target < today);
}

/** Milestones somebody marked at risk (§43, §72): the flag is manual, never guessed. */
export async function atRiskMilestones(companyId: string, milestoneId?: string, page?: AttentionRowPage): Promise<PlanningAttentionRow[]> {
  const rows = await prisma.projectMilestone.findMany({
    // Given a page, one page by id, for the attention reconciler to walk (PRD #51 §133-§135).
    where: { companyId, archivedAt: null, status: "AT_RISK", ...(milestoneId ? { id: milestoneId } : {}), ...(page?.after ? { id: { gt: page.after } } : {}), project: { is: ACTIVE_PROJECT } },
    orderBy: { id: "asc" },
    take: page?.take ?? LIMIT,
    select: ROW_SELECT,
  });
  return rows.map((row) => ({ ...row, target: targetDateOf({ baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate) }), today: "" }));
}

/** Open critical blockers on milestones still to be achieved (§157). */
export async function criticallyBlockedMilestones(companyId: string, milestoneId?: string) {
  const blockers = await prisma.projectMilestoneBlocker.findMany({
    where: { ...CRITICAL_BLOCKER, companyId, ...(milestoneId ? { milestoneId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: LIMIT,
    select: BLOCKER_SELECT,
  });
  return byMilestone(blockers);
}

/**
 * Critically blocked milestones a page of milestones at a time, and where the
 * next page starts, so the attention reconciler walks every one of them (PRD
 * #51 §133-§135). Paged by milestone rather than by blocker: a milestone's
 * blockers all land on the same page, so its item never splits in two.
 */
export async function criticallyBlockedMilestonePage(companyId: string, page: AttentionRowPage): Promise<AttentionRows<BlockedMilestone>> {
  const milestones = await prisma.projectMilestone.findMany({
    where: { companyId, ...OPEN_MILESTONE, project: { is: ACTIVE_PROJECT }, blockers: { some: { severity: "CRITICAL", resolvedAt: null } }, ...(page.after ? { id: { gt: page.after } } : {}) },
    orderBy: { id: "asc" },
    take: page.take,
    select: { id: true },
  });
  const blockers = milestones.length
    ? await prisma.projectMilestoneBlocker.findMany({
        where: { ...CRITICAL_BLOCKER, companyId, milestoneId: { in: milestones.map((row) => row.id) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: BLOCKER_SELECT,
      })
    : [];
  return { rows: byMilestone(blockers), next: milestones.length === page.take ? milestones[milestones.length - 1].id : null };
}

const CRITICAL_BLOCKER = { severity: "CRITICAL", resolvedAt: null, milestone: { is: { ...OPEN_MILESTONE, project: { is: ACTIVE_PROJECT } } } } satisfies Prisma.ProjectMilestoneBlockerWhereInput;
const BLOCKER_SELECT = { id: true, title: true, ownerMemberId: true, milestone: { select: ROW_SELECT } } satisfies Prisma.ProjectMilestoneBlockerSelect;
type CriticalBlocker = Prisma.ProjectMilestoneBlockerGetPayload<{ select: typeof BLOCKER_SELECT }>;
export type BlockedMilestone = { milestone: CriticalBlocker["milestone"]; first: CriticalBlocker; owners: string[]; count: number };

function byMilestone(blockers: CriticalBlocker[]): BlockedMilestone[] {
  const grouped = new Map<string, BlockedMilestone>();
  for (const blocker of blockers) {
    const entry = grouped.get(blocker.milestone.id) ?? { milestone: blocker.milestone, first: blocker, owners: [], count: 0 };
    entry.count += 1;
    if (blocker.ownerMemberId) entry.owners.push(blocker.ownerMemberId);
    grouped.set(blocker.milestone.id, entry);
  }
  return [...grouped.values()];
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

const JOB = "planning.milestones";
/** Milestones read at a time; a company with more is walked by cursor, never cut off (PRD #51 §133-§138). */
const BATCH = 100;

type MilestoneRow = Prisma.ProjectMilestoneGetPayload<{ select: typeof ROW_SELECT }>;

/**
 * Sends one reminder unless this milestone was already reminded about this
 * target date, and says whether it went.
 *
 * The ledger row is claimed in the transaction that enqueues the event, so two
 * runs at once, or a run after retention has purged the first event from the
 * outbox, still send it once (PRD #51 §15-§19). A reminder with nobody to tell
 * claims nothing: an owner named before the next run still hears.
 */
async function sendReminder(companyId: string, eventType: string, row: MilestoneRow, target: string, recipients: Array<string | null>): Promise<boolean> {
  const memberIds = [...new Set(recipients.filter((id): id is string => Boolean(id)))];
  if (!memberIds.length) return false;
  const claim = { companyId, jobKey: JOB, key: `${row.id}:${eventType}:${target}` };
  if (await idempotencyKeyClaimed(prisma, claim)) return false;
  return prisma.$transaction(async (tx) => {
    if (!(await claimIdempotencyKey(tx, claim))) return false;
    await notifyMilestone(tx, {
      eventType,
      milestone: { id: row.id, companyId, projectId: row.projectId, name: row.name, ownerMemberId: row.ownerMemberId, critical: row.critical, externallyCommitted: row.externallyCommitted },
      projectName: row.project.name,
      actorMemberId: null,
      memberIds,
      payload: { targetDate: target, dateLabel: dateLabel(target) },
    });
    return true;
  });
}

/**
 * Due-soon and overdue reminders (job `planning.milestones`, §71, §166, §167,
 * §251, §252). Each is sent once per milestone per target date: moving the
 * forecast starts a new reminder, running the job again does not.
 *
 * Every milestone due in the company is reached, whichever of its dates it is
 * due by and however many there are, and one that fails is logged by id and
 * stepped over; the company's run then fails, after everything else has been
 * sent (PRD #51 §30-§36, §133-§138). Reminding never changes a milestone's
 * status (§92).
 */
export async function runMilestoneReminders(now = new Date()): Promise<{ dueSoon: number; overdue: number }> {
  const counts = { dueSoon: 0, overdue: 0 };
  const companyRun = await forEachCompany(JOB, async ({ companyId }) => {
    const settings = await resolvePlanningSettings(companyId);
    const today = localDate(now, settings.timezone);
    const executives = settings.notifyExecutivesOnCriticalChanges ? await executiveMemberIds(prisma, companyId) : [];
    const passes = [
      { counter: "dueSoon", eventType: NotificationEvent.MILESTONE_DUE_SOON, range: { gte: startOf(today), lte: endOf(addLocalDays(today, settings.milestoneReminderDays)) } },
      { counter: "overdue", eventType: NotificationEvent.MILESTONE_OVERDUE, range: { lt: startOf(today) } },
    ] as const;

    let failed = 0;
    for (const pass of passes) {
      for (let after: string | undefined; !jobStopRequested(); ) {
        const rows = await prisma.projectMilestone.findMany({
          where: { companyId, ...OPEN_MILESTONE, project: { is: ACTIVE_PROJECT }, OR: targetIn(pass.range), ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: "asc" },
          take: BATCH,
          select: ROW_SELECT,
        });
        for (const row of rows) {
          const target = targetDateOf({ baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate) })!;
          // Due soon goes to the owner, and to the project manager for a critical milestone; overdue to both (§251, §252).
          const recipients = pass.counter === "dueSoon"
            ? [row.ownerMemberId ?? row.project.projectManagerMemberId, row.critical ? row.project.projectManagerMemberId : null]
            : [row.ownerMemberId, row.project.projectManagerMemberId, ...(row.critical && row.externallyCommitted ? executives : [])];
          try {
            if (await sendReminder(companyId, pass.eventType, row, target, recipients)) counts[pass.counter] += 1;
          } catch (error) {
            failed += 1;
            logger.error(`${JOB}.item_failed`, { companyId, milestoneId: row.id, eventType: pass.eventType, ...serialiseError(error) });
          }
        }
        if (rows.length < BATCH) break;
        after = rows[rows.length - 1]!.id;
      }
    }
    if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} milestone reminders could not be sent`);
  }, { moduleKey: MODULE });
  if (counts.overdue) incrementCounter(Metric.MILESTONE_OVERDUE, {}, counts.overdue);
  assertEveryCompanySucceeded(JOB, companyRun);
  return counts;
}
