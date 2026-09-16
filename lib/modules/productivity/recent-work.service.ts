import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
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

/** Job `recentwork.prune` (§104, §105): older than the company's retention, and past the hundred newest per member. */
export async function pruneRecentWork(now = new Date()): Promise<{ pruned: number }> {
  let pruned = 0;
  const companyRun = await forEachCompany("recentwork.prune", async (system) => {
    const company = { id: system.companyId };
    const settings = await resolveProductivitySettings(company.id);
    const cutoff = new Date(now.getTime() - settings.recentWorkRetentionDays * 86_400_000);
    pruned += (await prisma.recentItem.deleteMany({ where: { companyId: company.id, lastAccessedAt: { lt: cutoff } } })).count;
    const crowded = await prisma.recentItem.groupBy({ by: ["memberId"], where: { companyId: company.id }, _count: { _all: true }, having: { memberId: { _count: { gt: RECENT_CAP } } } });
    for (const member of crowded) {
      const keep = await prisma.recentItem.findMany({ where: { companyId: company.id, memberId: member.memberId }, orderBy: { lastAccessedAt: "desc" }, take: RECENT_CAP, select: { id: true } });
      pruned += (await prisma.recentItem.deleteMany({ where: { companyId: company.id, memberId: member.memberId, id: { notIn: keep.map((row) => row.id) } } })).count;
    }
  }, { includeInactive: true });
  if (pruned) incrementCounter(Metric.RECENT_WORK_PRUNED, {}, pruned);
  assertEveryCompanySucceeded("recentwork.prune", companyRun);
  return { pruned };
}
