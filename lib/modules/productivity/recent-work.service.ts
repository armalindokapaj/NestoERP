import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { canNavigate, isNavigableType, missingReferences, resolveNavigable, type NavigableEntityDTO } from "./navigable.registry";
import { resolveProductivitySettings } from "./productivity.settings";
import { contextOpening, narrowedTo, personalContexts, type InCompany } from "./productivity.workspace";

/**
 * Recent Work (PRD #45 §94-§115, §162, §251, §254-§259).
 *
 * The meaningful records a member opened lately — projects, tasks, meetings,
 * logs, documents — never pages, filters or searches. Every open moves the record to the
 * top (one row per record, Fast Re-entry §21, §72), resolved against current access every
 * time it is shown, kept for the company's retention and capped at two hundred.
 * It is personal: not audit, not activity, not a measure of anybody's work.
 */

/** The newest unique records kept per member, whichever comes first with the retention days (Fast Re-entry §68). */
export const RECENT_CAP = 200;

export type RecentWorkItemDTO = NavigableEntityDTO & InCompany & { lastAccessedAt: string };

/**
 * Records that this member opened a record (§99, §100). Silent: a page never
 * fails because recent work could not be written, and nothing is recorded for
 * a record the member cannot open.
 */
export async function recordRecentAccess(context: UserContext, entityType: string, entityId: string, options: { now?: Date; verified?: boolean } = {}): Promise<boolean> {
  try {
    if (!isNavigableType(entityType)) return false;
    const now = options.now ?? new Date();
    if (!(await resolveProductivitySettings(context.companyId)).recentWorkEnabled) return false;
    if (!options.verified && !(await canNavigate(context, entityType, entityId))) return false;
    // One statement, INSERT … ON CONFLICT: two tabs opening the same record update one row (Fast Re-entry §183, §184).
    await prisma.recentItem.upsert({
      where: { memberId_entityType_entityId: { memberId: context.membershipId, entityType, entityId } },
      create: { companyId: context.companyId, memberId: context.membershipId, entityType, entityId, lastAccessedAt: now },
      update: { lastAccessedAt: now, accessCount: { increment: 1 } },
    });
    return true;
  } catch (error) {
    // A lost race on the unique key is the same open; anything else is counted, never thrown (§134).
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) incrementCounter(Metric.RECENT_TOUCH_ERROR, {});
    return false;
  }
}

export async function listRecentWork(context: UserContext, options: { limit?: number } = {}): Promise<RecentWorkItemDTO[]> {
  if (!(await resolveProductivitySettings(context.companyId)).recentWorkEnabled) return [];
  const rows = await prisma.recentItem.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId },
    // Most recent first, then id: a total order, so which rows fill the cap is stable (AUD-08 §4, DT-04).
    orderBy: [{ lastAccessedAt: "desc" }, { id: "asc" }],
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

/* -------------------------------------------------------------------------- */
/* The active workspace (Workspace Context §43)                                */
/* -------------------------------------------------------------------------- */

/**
 * Recent work in the active workspace (§43): the selected company's in a
 * company workspace, the recent accessible work across companies in the Group
 * workspace. Each company's list is its own — this person's membership there,
 * resolved in that company's context, so a record they can no longer open is
 * gone — and the merge is newest first with every row naming its company.
 * `companyId` is a filter, ignored unless it is a company the person may use.
 */
export async function listRecentWorkForWorkspace(session: UserContext, options: { limit?: number; companyId?: string | null } = {}): Promise<RecentWorkItemDTO[]> {
  const contexts = narrowedTo(await personalContexts(session), options.companyId);
  const lists = await Promise.all(
    contexts.map(async (context) => {
      const company = { id: context.companyId, name: context.company.name };
      // Each list holds its own newest `limit`, so the newest `limit` of all of them is among them.
      return (await listRecentWork(context, { limit: options.limit })).map((item) => ({ ...item, company }));
    }),
  );
  return lists
    .flat()
    .sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt) || `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`))
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}

/** Records an open. In the Group workspace the record's own company keeps it — the person's membership there — never the company the session is anchored in. */
export async function recordRecentAccessForWorkspace(session: UserContext, entityType: string, entityId: string): Promise<boolean> {
  if (!isNavigableType(entityType)) return false;
  const owner = await contextOpening(session, { entityType, entityId });
  return owner ? recordRecentAccess(owner, entityType, entityId, { verified: true }) : false;
}

/** The person's own recent rows across the memberships the Group workspace reads; nobody else's is ever named. */
async function ownRecentWhere(session: UserContext) {
  return (await personalContexts(session)).map((context) => ({ companyId: context.companyId, memberId: context.membershipId }));
}

export async function removeRecentItemForWorkspace(session: UserContext, entityType: string, entityId: string): Promise<boolean> {
  const { count } = await prisma.recentItem.deleteMany({ where: { OR: await ownRecentWhere(session), entityType, entityId } });
  return count > 0;
}

export async function clearRecentWorkForWorkspace(session: UserContext): Promise<number> {
  return (await prisma.recentItem.deleteMany({ where: { OR: await ownRecentWhere(session) } })).count;
}

const PRUNE_JOB = "recentwork.prune";
/** Rows deleted per statement past retention, so a long-neglected company is never one huge delete (PRD #51 §132-§134). */
const PRUNE_BATCH = 500;

/**
 * Job `recentwork.prune` (§104, §105): older than the company's retention, and
 * past the newest `RECENT_CAP` per member (Fast Re-entry §68, §178).
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

const STALE_JOB = "productivity.stale-references";

/**
 * Job `productivity.stale-references` (Fast Re-entry §118, §119, §177, §179):
 * favorites and recent items whose record no longer exists, or whose type is
 * no longer navigable. They were already invisible — every read resolves
 * access afresh — so this only stops them taking space. A record the person
 * merely cannot open is never removed here: access can come back (§118).
 * Housekeeping, so suspended companies are included.
 */
export async function pruneStaleReferences(options: { dryRun?: boolean } = {}): Promise<{ removed: number; dryRun: boolean }> {
  const dryRun = options.dryRun ?? false;
  let removed = 0;
  const run = await forEachCompany(STALE_JOB, async ({ companyId }) => {
    removed += await pruneMissing(companyId, dryRun);
  }, { includeInactive: true });
  assertEveryCompanySucceeded(STALE_JOB, run);
  return { removed, dryRun };
}

/** One company's stale references, in recent work and favorites, walked by id in batches. */
async function pruneMissing(companyId: string, dryRun: boolean): Promise<number> {
  let removed = 0;
  for (const table of ["recent", "favorite"] as const) {
    let after = "";
    while (!jobStopRequested()) {
      const batch =
        table === "recent"
          ? await prisma.recentItem.findMany({ where: { companyId, id: { gt: after } }, orderBy: { id: "asc" }, take: PRUNE_BATCH, select: { id: true, entityType: true, entityId: true } })
          : await prisma.userFavorite.findMany({ where: { companyId, id: { gt: after } }, orderBy: { id: "asc" }, take: PRUNE_BATCH, select: { id: true, entityType: true, entityId: true } });
      if (batch.length === 0) break;
      after = batch[batch.length - 1].id;
      const missing = new Set((await missingReferences(batch)).map((ref) => `${ref.entityType}:${ref.entityId}`));
      const ids = batch.filter((row) => missing.has(`${row.entityType}:${row.entityId}`)).map((row) => row.id);
      if (ids.length) {
        if (dryRun) removed += ids.length;
        else removed += (table === "recent" ? await prisma.recentItem.deleteMany({ where: { companyId, id: { in: ids } } }) : await prisma.userFavorite.deleteMany({ where: { companyId, id: { in: ids } } })).count;
      }
      if (batch.length < PRUNE_BATCH) break;
    }
  }
  return removed;
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
