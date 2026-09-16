import { can } from "@/lib/access/can";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import { databaseNow } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { resolveAttentionFor } from "./attention.service";
import {
  ATTENTION_PAGE_SIZE,
  attentionConditionDefinitions,
  attentionDedupeKey,
  readerAllowed,
  type AttentionCandidate,
  type AttentionConditionDefinition,
} from "./attention.conditions";

/**
 * Attention reconciliation (PRD #38 §84, §85, PRD #51 §68-§70, §184).
 *
 * Runs on the scheduler. For each company it asks every condition what is true
 * now, re-reads each record in each recipient's own context, and makes the
 * attention table agree:
 *
 *   - a condition that holds for someone who can open the record is an ACTIVE
 *     item (created, or refreshed if the wording or priority moved)
 *   - an ACTIVE item that no longer matches — the condition ended, the person
 *     lost access, the record was archived — is RESOLVED
 *   - a DISMISSED item stays dismissed for that episode; a new episode (a new
 *     due date, a new approval cycle) has a new key and appears again
 *
 * Idempotent: running it twice in a row changes nothing the second time.
 *
 * Bounded (PRD #51 §133-§138): a condition is read a page at a time and each
 * page written before the next is read, so memory holds one page, not a
 * company. What ended is found by a mark rather than a list: every item a pass
 * finds still true carries that pass's `lastEvaluatedAt`, and once the whole
 * condition has been read, the active items without it are the ones that
 * ended. A condition that failed or was stopped part-way resolves nothing — an
 * item whose record simply was not reached yet is not an item whose condition
 * ended.
 */

export type ReconcileResult = {
  companies: number;
  created: number;
  refreshed: number;
  resolved: number;
  /** The counts are what the pass would have done; it wrote nothing (PRD #51 §165, §166). */
  dryRun: boolean;
};

type Pass = { now: Date; dryRun: boolean; pageSize: number };
type Counts = { created: number; refreshed: number; resolved: number };

type Desired = {
  recipientMemberId: string;
  conditionKey: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  projectId: string | null;
  title: string;
  body: string | null;
  priority: AttentionCandidate["priority"];
  dismissible: boolean;
  dedupeKey: string;
};

const pairKey = (memberId: string, dedupeKey: string) => `${memberId}|${dedupeKey}`;

/** Items resolved per statement once a condition has been read to its end. */
const RESOLVE_BATCH = 500;

export async function reconcileAttention(
  options: { companyId?: string; now?: Date; dryRun?: boolean; pageSize?: number } = {},
): Promise<ReconcileResult> {
  const pass: Pass = { now: options.now ?? new Date(), dryRun: Boolean(options.dryRun), pageSize: options.pageSize ?? ATTENTION_PAGE_SIZE };
  const result: ReconcileResult = { companies: 0, created: 0, refreshed: 0, resolved: 0, dryRun: pass.dryRun };
  const failedConditions = new Set<string>();
  const run = await forEachCompany(
    "attention.reconcile",
    async ({ companyId }) => {
      const outcome = await reconcileCompany(companyId, pass);
      result.companies += 1;
      result.created += outcome.created;
      result.refreshed += outcome.refreshed;
      result.resolved += outcome.resolved;
      for (const key of outcome.failed) failedConditions.add(key);
    },
    options.companyId ? { companyIds: [options.companyId] } : {},
  );
  assertEveryCompanySucceeded("attention.reconcile", run);
  if (failedConditions.size > 0) {
    // Every other condition had its pass; the run still fails, so the broken
    // one is visible where operators look rather than only in a log (PRD #51 §42).
    throw new JobError("PARTIAL_FAILURE", `attention.reconcile: conditions ${[...failedConditions].join(", ")} failed; their items were left as they were`);
  }
  return result;
}

async function reconcileCompany(companyId: string, pass: Pass): Promise<Counts & { failed: string[] }> {
  const outcome = { created: 0, refreshed: 0, resolved: 0, failed: [] as string[] };
  const desiredFor = audience(companyId);
  for (const definition of attentionConditionDefinitions()) {
    if (jobStopRequested()) break;
    try {
      const counts = await reconcileCondition(companyId, definition, pass, desiredFor);
      outcome.created += counts.created;
      outcome.refreshed += counts.refreshed;
      outcome.resolved += counts.resolved;
    } catch (error) {
      // One broken condition must not cost the others their pass, and resolves
      // nothing of its own: its existing items are left exactly as they are.
      outcome.failed.push(definition.key);
      logger.error("attention.reconcile.item_failed", { companyId, condition: definition.key, ...serialiseError(error) });
    }
  }
  return outcome;
}

async function reconcileCondition(
  companyId: string,
  definition: AttentionConditionDefinition,
  pass: Pass,
  desiredFor: ReturnType<typeof audience>,
): Promise<Counts> {
  const counts: Counts = { created: 0, refreshed: 0, resolved: 0 };
  // The database's clock, not the pass's `now`: two workers, or a pass asked
  // about another day, agree on which of two marks is later (PRD #51 §159).
  const mark = await databaseNow();
  // A dry run leaves no mark, so it counts instead: what was active, less what
  // the pass found still true.
  const activeBefore = pass.dryRun ? await prisma.attentionItem.count({ where: { companyId, conditionKey: definition.key, status: "ACTIVE" } }) : 0;
  let stillActive = 0;

  let cursor: string | null = null;
  do {
    // Stopped part-way, the unread pages are unknown: resolve nothing.
    if (jobStopRequested()) return counts;
    const page = await definition.page(companyId, pass.now, cursor, pass.pageSize);
    const written = await writePage(companyId, await desiredFor(definition, page.candidates), pass, mark);
    counts.created += written.created;
    counts.refreshed += written.refreshed;
    stillActive += written.active;
    cursor = page.next;
  } while (cursor !== null);

  counts.resolved = pass.dryRun ? Math.max(0, activeBefore - stillActive) : await resolveUnmarked(companyId, definition.key, pass, mark);
  return counts;
}

/**
 * Creates what is missing, refreshes what moved and marks what is unchanged,
 * for one page's desired items.
 */
async function writePage(companyId: string, desired: Desired[], pass: Pass, mark: Date): Promise<{ created: number; refreshed: number; active: number }> {
  if (desired.length === 0) return { created: 0, refreshed: 0, active: 0 };
  const existing = await existingItems(companyId, desired);

  let created = 0;
  const missing = desired.filter((item) => !existing.has(pairKey(item.recipientMemberId, item.dedupeKey)));
  if (missing.length > 0 && pass.dryRun) {
    created = missing.length;
  } else if (missing.length > 0) {
    const inserted = await prisma.attentionItem.createManyAndReturn({
      data: missing.map((item) => ({ ...item, companyId, lastEvaluatedAt: mark })),
      skipDuplicates: true,
      select: { recipientMemberId: true, dedupeKey: true },
    });
    created = inserted.length;
    if (inserted.length < missing.length) {
      // Another pass inserted some of these between the read and the insert.
      // They are existing items now, and must carry this pass's mark as well,
      // or this pass would resolve them as ended.
      const ours = new Set(inserted.map((row) => pairKey(row.recipientMemberId, row.dedupeKey)));
      const theirs = await existingItems(companyId, missing.filter((item) => !ours.has(pairKey(item.recipientMemberId, item.dedupeKey))));
      for (const [key, row] of theirs) existing.set(key, row);
    }
  }

  let refreshed = 0;
  let active = 0;
  const unchanged: string[] = [];
  for (const item of desired) {
    const current = existing.get(pairKey(item.recipientMemberId, item.dedupeKey));
    if (!current || current.status === "DISMISSED") continue;
    if (current.status === "ACTIVE") active += 1;
    const changed =
      current.status !== "ACTIVE" ||
      current.title !== item.title ||
      current.priority !== item.priority ||
      current.body !== item.body ||
      current.dismissible !== item.dismissible;
    if (!changed) {
      unchanged.push(current.id);
      continue;
    }
    if (pass.dryRun) {
      refreshed += 1;
      continue;
    }
    // Priority may escalate as a deadline nears; the item is the same item.
    // Bound to the status read, so somebody dismissing it this moment keeps it
    // dismissed, and to an older mark, so a later pass's work is never undone.
    const { count } = await prisma.attentionItem.updateMany({
      where: { id: current.id, status: current.status, lastEvaluatedAt: { lt: mark } },
      data: {
        status: "ACTIVE",
        resolvedAt: null,
        title: item.title,
        body: item.body,
        priority: item.priority,
        dismissible: item.dismissible,
        lastEvaluatedAt: mark,
      },
    });
    refreshed += count;
  }
  if (!pass.dryRun && unchanged.length > 0) {
    await prisma.attentionItem.updateMany({
      where: { id: { in: unchanged }, status: "ACTIVE", lastEvaluatedAt: { lt: mark } },
      data: { lastEvaluatedAt: mark },
    });
  }
  return { created, refreshed, active };
}

async function existingItems(companyId: string, items: Pick<Desired, "recipientMemberId" | "dedupeKey">[]) {
  const rows = await prisma.attentionItem.findMany({
    where: {
      companyId,
      dedupeKey: { in: [...new Set(items.map((item) => item.dedupeKey))] },
      recipientMemberId: { in: [...new Set(items.map((item) => item.recipientMemberId))] },
    },
    select: { id: true, recipientMemberId: true, dedupeKey: true, status: true, title: true, body: true, priority: true, dismissible: true },
  });
  return new Map(rows.map((row) => [pairKey(row.recipientMemberId, row.dedupeKey), row]));
}

/** A condition read whole: every active item this pass did not mark has ended. */
async function resolveUnmarked(companyId: string, conditionKey: string, pass: Pass, mark: Date): Promise<number> {
  let resolved = 0;
  for (;;) {
    const { count } = await prisma.attentionItem.updateMany({
      where: { companyId, conditionKey, status: "ACTIVE", lastEvaluatedAt: { lt: mark } },
      data: { status: "RESOLVED", resolvedAt: pass.now, lastEvaluatedAt: mark },
      limit: RESOLVE_BATCH,
    });
    resolved += count;
    if (count < RESOLVE_BATCH || jobStopRequested()) return resolved;
  }
}

/**
 * Who a company's candidates reach: named members plus permission holders,
 * each one then checked against the record in their own context.
 *
 * Member contexts are built once per company pass and kept for it — a
 * company's members, not its records; whether each member can open a record
 * is remembered for one page only.
 */
function audience(companyId: string) {
  const contexts = new Map<string, UserContext | null>();
  let everyone: string[] | null = null;

  async function contextsFor(memberIds: string[]): Promise<void> {
    const missing = [...new Set(memberIds)].filter((id) => !contexts.has(id));
    if (missing.length === 0) return;
    const built = await buildMemberContexts(companyId, missing);
    for (const id of missing) contexts.set(id, built.get(id) ?? null);
  }

  return async function desiredFor(definition: AttentionConditionDefinition, candidates: AttentionCandidate[]): Promise<Desired[]> {
    if (candidates.length === 0) return [];
    const named = candidates.flatMap((candidate) => candidate.recipients.filter((id): id is string => Boolean(id)));
    if (everyone === null && candidates.some((candidate) => candidate.holders?.length)) {
      everyone = (await prisma.companyMember.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id);
    }
    await contextsFor([...named, ...(everyone ?? [])]);

    const readable = new Map<string, boolean>();
    async function canOpen(context: UserContext, type: string, id: string): Promise<boolean> {
      const key = `${context.membershipId}|${type}|${id}`;
      let answer = readable.get(key);
      if (answer === undefined) {
        const record = await loadRecord(context, type, id);
        answer = record !== null && !record.archived;
        readable.set(key, answer);
      }
      return answer;
    }

    const desired = new Map<string, Desired>();
    for (const candidate of candidates) {
      const registry = recordDefinition(candidate.entityType);
      if (!registry) continue;

      const members = new Set(candidate.recipients.filter((id): id is string => Boolean(id)));
      if (candidate.holders?.length) {
        for (const memberId of everyone ?? []) {
          const context = contexts.get(memberId);
          if (context && candidate.holders.every((permission) => can(context, permission))) members.add(memberId);
        }
      }
      for (const excluded of candidate.exclude ?? []) members.delete(excluded);

      const dedupeKey = attentionDedupeKey(definition.key, candidate);
      for (const memberId of members) {
        const context = contexts.get(memberId);
        if (!context) continue;
        if (!readerAllowed(context, definition)) continue;
        if (!(await canOpen(context, candidate.entityType, candidate.entityId))) continue;
        desired.set(pairKey(memberId, dedupeKey), {
          recipientMemberId: memberId,
          conditionKey: definition.key,
          moduleKey: registry.moduleKey,
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          projectId: candidate.projectId,
          title: candidate.title.slice(0, 300),
          body: candidate.body?.slice(0, 1000) ?? null,
          priority: candidate.priority,
          dismissible: candidate.dismissible,
          dedupeKey,
        });
      }
    }
    return [...desired.values()];
  };
}

/**
 * Resolves the items for one record straight away, when the service that ended
 * the condition knows it did (PRD #38 §85). The scheduled run would get there;
 * this makes it immediate for the obvious cases.
 */
export async function resolveAttentionForRecord(
  tx: Pick<typeof prisma, "attentionItem">,
  companyId: string,
  entityType: string,
  entityId: string,
  conditionKeys: string[],
  options: { recipientMemberId?: string; includeDismissed?: boolean } = {},
): Promise<void> {
  await resolveAttentionFor(tx, { companyId, entityType, entityId, conditionKeys, ...options });
}
