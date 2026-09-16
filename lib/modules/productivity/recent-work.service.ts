import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { canNavigate, isNavigableType, resolveNavigable, type NavigableEntityDTO } from "./navigable.registry";
import { resolveProductivitySettings } from "./productivity.settings";

/**
 * Recent Work (PRD #45 §94-§115, §162, §251, §254-§259).
 *
 * The meaningful records a member opened lately — projects, tasks, meetings,
 * logs, documents — never pages, filters or searches. Written at most once per
 * record per member every ten minutes, resolved against current access every
 * time it is shown, kept for the company's retention and capped at a hundred.
 * It is personal: not audit, not activity, not a measure of anybody's work.
 */

export const RECENT_CAP = 100;
export const RECENT_DEBOUNCE_MS = 10 * 60_000;

export type RecentWorkItemDTO = NavigableEntityDTO & { lastAccessedAt: string };

/**
 * Records that this member opened a record (§99, §100). Silent: a page never
 * fails because recent work could not be written, and nothing is recorded for
 * a record the member cannot open.
 */
export async function recordRecentAccess(context: UserContext, entityType: string, entityId: string, options: { now?: Date; verified?: boolean } = {}): Promise<boolean> {
  try {
    if (!isNavigableType(entityType)) return false;
    const now = options.now ?? new Date();
    const key = { memberId_entityType_entityId: { memberId: context.membershipId, entityType, entityId } };
    const existing = await prisma.recentItem.findUnique({ where: key, select: { lastAccessedAt: true } });
    if (existing && now.getTime() - existing.lastAccessedAt.getTime() < RECENT_DEBOUNCE_MS) return false;
    if (!(await resolveProductivitySettings(context.companyId)).recentWorkEnabled) return false;
    if (!options.verified && !(await canNavigate(context, entityType, entityId))) return false;
    if (existing) {
      await prisma.recentItem.update({ where: key, data: { lastAccessedAt: now, accessCount: { increment: 1 } } });
    } else {
      try {
        await prisma.recentItem.create({ data: { companyId: context.companyId, memberId: context.membershipId, entityType, entityId, lastAccessedAt: now } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function listRecentWork(context: UserContext, options: { limit?: number } = {}): Promise<RecentWorkItemDTO[]> {
  if (!(await resolveProductivitySettings(context.companyId)).recentWorkEnabled) return [];
  const rows = await prisma.recentItem.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId },
    orderBy: { lastAccessedAt: "desc" },
    take: RECENT_CAP,
    select: { entityType: true, entityId: true, lastAccessedAt: true },
  });
  const accessed = new Map(rows.map((row) => [`${row.entityType}:${row.entityId}`, row.lastAccessedAt.toISOString()]));
  const items = await resolveNavigable(context, rows);
  return items.slice(0, options.limit ?? RECENT_CAP).map((item) => ({ ...item, lastAccessedAt: accessed.get(`${item.entityType}:${item.entityId}`)! }));
}

/** Forgets one recent record of this member's, and says whether there was one (PRD #47 §76). */
export async function removeRecentItem(context: UserContext, entityType: string, entityId: string): Promise<boolean> {
  const { count } = await prisma.recentItem.deleteMany({ where: { companyId: context.companyId, memberId: context.membershipId, entityType, entityId } });
  return count > 0;
}

export async function clearRecentWork(context: UserContext): Promise<number> {
  const removed = await prisma.recentItem.deleteMany({ where: { companyId: context.companyId, memberId: context.membershipId } });
  return removed.count;
}

const PRUNE_JOB = "recentwork.prune";
/** Rows deleted per statement past retention, so a long-neglected company is never one huge delete (PRD #51 §132-§134). */
const PRUNE_BATCH = 500;

/**
 * Job `recentwork.prune` (§104, §105): older than the company's retention, and
 * past the hundred newest per member.
 *
 * Housekeeping, so suspended companies are pruned too. A record a member opens
 * while the job runs is never what it removes: each delete is bound to the
 * access time it decided on, and an open moves that time past it. With
 * `dryRun` it counts what it would remove and removes nothing (PRD #51 §165).
 */
export async function pruneRecentWork(now = new Date(), options: { dryRun?: boolean } = {}): Promise<{ pruned: number; dryRun: boolean }> {
  const dryRun = options.dryRun ?? false;
  let pruned = 0;
  const companyRun = await forEachCompany(
    PRUNE_JOB,
    async ({ companyId }) => {
      // Read, not resolved: resolving creates the row, and a dry run writes nothing. Recording
      // recent work resolves it first, so a company without one has nothing to prune.
      const settings = await prisma.productivitySettings.findUnique({ where: { companyId }, select: { recentWorkRetentionDays: true } });
      if (!settings) return;
      const cutoff = new Date(now.getTime() - settings.recentWorkRetentionDays * 86_400_000);
      const expired = await pruneExpired(companyId, cutoff, dryRun);
      pruned += expired;
      const crowded = await pruneCrowded(companyId, cutoff, dryRun);
      pruned += crowded;
    },
    { includeInactive: true },
  );
  if (pruned && !dryRun) incrementCounter(Metric.RECENT_WORK_PRUNED, {}, pruned);
  assertEveryCompanySucceeded(PRUNE_JOB, companyRun);
  return { pruned, dryRun };
}

async function pruneExpired(companyId: string, cutoff: Date, dryRun: boolean): Promise<number> {
  const where = { companyId, lastAccessedAt: { lt: cutoff } };
  if (dryRun) return prisma.recentItem.count({ where });
  let removed = 0;
  while (!jobStopRequested()) {
    const batch = await prisma.recentItem.findMany({ where, orderBy: { id: "asc" }, take: PRUNE_BATCH, select: { id: true } });
    if (batch.length === 0) break;
    // The cutoff is part of the delete as well as the read: a record opened in between is inside retention again.
    removed += (await prisma.recentItem.deleteMany({ where: { ...where, id: { in: batch.map((row) => row.id) } } })).count;
    if (batch.length < PRUNE_BATCH) break;
  }
  return removed;
}

/**
 * Past the hundred newest per member (§105). The line is drawn at the hundredth
 * newest row (ties broken by id), and the delete removes only what is older
 * than that row — never "everything not in the hundred just read", which would
 * take a record opened a moment after the read with it.
 * Rows past retention are left to `pruneExpired`, so a dry run does not count
 * them twice.
 */
async function pruneCrowded(companyId: string, cutoff: Date, dryRun: boolean): Promise<number> {
  const retained = { companyId, lastAccessedAt: { gte: cutoff } };
  const crowded = await prisma.recentItem.groupBy({ by: ["memberId"], where: retained, _count: { _all: true }, having: { memberId: { _count: { gt: RECENT_CAP } } }, orderBy: { memberId: "asc" } });
  let removed = 0;
  for (const { memberId } of crowded) {
    if (jobStopRequested()) break;
    const [oldestKept] = await prisma.recentItem.findMany({ where: { ...retained, memberId }, orderBy: [{ lastAccessedAt: "desc" }, { id: "desc" }], skip: RECENT_CAP - 1, take: 1, select: { id: true, lastAccessedAt: true } });
    if (!oldestKept) continue;
    const where = { ...retained, memberId, OR: [{ lastAccessedAt: { lt: oldestKept.lastAccessedAt } }, { lastAccessedAt: oldestKept.lastAccessedAt, id: { lt: oldestKept.id } }] };
    removed += dryRun ? await prisma.recentItem.count({ where }) : (await prisma.recentItem.deleteMany({ where })).count;
  }
  return removed;
}
