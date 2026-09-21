import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { WINDOW } from "./approvals.cycle-provider";
import { afterCursor, completeItem, decodeCursor, encodeCursor, sortItems, sortKey } from "./approvals.order";
import { approvalError, providerUnavailable, type ApprovalProvider, type ProviderItem, type ProviderQuery } from "./approvals.provider";
import { approvalProviders, type ApprovalProviderRegistry } from "./approvals.registry";
import type { ApprovalQuery } from "./approvals.schema";
import type {
  ApprovalCompany,
  ApprovalCounts,
  ApprovalDecision,
  ApprovalDecisionResult,
  ApprovalProviderSummary,
  ApprovalQueueResult,
  UnifiedApprovalDetail,
  UnifiedApprovalItem,
} from "./approvals.types";

/**
 * The Unified Approval Service (PRD #41 §12).
 *
 * Resolves the providers this reader may use, asks them with bounded
 * concurrency, merges and orders what comes back, and routes a decision to the
 * one provider that owns it. It never touches a module's table: reading and
 * deciding both belong to the providers, and through them to the modules (§3).
 *
 * One source failing is one source missing, reported as such — the rest of the
 * queue still loads and no count is invented for the source that failed (§130,
 * §201). An access refusal from a source is the same as it having nothing to
 * show, never a partial leak.
 */

const PROVIDER_CONCURRENCY = 4;

type Options = { registry?: ApprovalProviderRegistry; now?: Date };

function assertCenter(context: UserContext): void {
  assertModule(context, "approvals");
  assertPermission(context, "approvals.view");
}

export function summary(provider: ApprovalProvider): ApprovalProviderSummary {
  return { key: provider.key, label: provider.label, moduleKey: provider.moduleKey };
}

async function bounded<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * One source to ask: a provider, read as one company's own context. A company
 * workspace asks each provider once, as the session; the Group workspace asks
 * each provider once per company the person may read, as their own context in
 * that company, and marks what comes back with that company (Workspace Context
 * §45, §57). The provider is never told to look beyond the context it is given.
 */
export type Source = { context: UserContext; provider: ApprovalProvider; company?: ApprovalCompany };

/** Answers are aligned with `sources`, so a caller can tell which company a list came from. */
export async function askSources(
  sources: Source[],
  query: ProviderQuery,
): Promise<{ items: ProviderItem[][]; failed: ApprovalProviderSummary[] }> {
  const failed: ApprovalProviderSummary[] = [];
  const items = await bounded(sources, PROVIDER_CONCURRENCY, async ({ context, provider, company }) => {
    const started = Date.now();
    try {
      const rows = await provider.queue(context, query);
      return company ? rows.map((row) => ({ ...row, company })) : rows;
    } catch (error) {
      failed.push(company ? { ...summary(provider), company } : summary(provider));
      incrementCounter(Metric.APPROVALS_PROVIDER_FAILURE, { provider: provider.key });
      logger.error("approvals.provider.failed", {
        providerKey: provider.key,
        companyId: context.companyId,
        memberId: context.membershipId,
        tab: query.tab,
        error: error instanceof Error ? error.message : "unknown",
      });
      return [];
    } finally {
      incrementCounter(Metric.APPROVALS_PROVIDER_DURATION_MS, { provider: provider.key }, Date.now() - started);
    }
  });
  return { items, failed };
}

async function askProviders(
  context: UserContext,
  providers: ApprovalProvider[],
  query: ProviderQuery,
): Promise<{ items: ProviderItem[][]; failed: ApprovalProviderSummary[] }> {
  return askSources(
    providers.map((provider) => ({ context, provider })),
    query,
  );
}

export function waitingQuery(now: Date): ProviderQuery {
  return { tab: "waiting", statuses: [], returned: "all", order: "desc", after: null, limit: WINDOW, now };
}

export function countsOf(items: UnifiedApprovalItem[], capped: boolean): ApprovalCounts {
  return {
    waiting: items.length,
    overdue: items.filter((item) => item.dueState === "overdue").length,
    critical: items.filter((item) => item.priority === "CRITICAL").length,
    capped,
  };
}

/** What waits on this person, across every source they can use (§96, §192). */
export async function getApprovalCounts(context: UserContext, options: Options = {}): Promise<ApprovalCounts & { failedProviders: ApprovalProviderSummary[] }> {
  assertCenter(context);
  const registry = options.registry ?? approvalProviders;
  const now = options.now ?? new Date();
  const { items, failed } = await askProviders(context, registry.getEnabledProviders(context), waitingQuery(now));
  return { ...countsOf(items.flat().map((item) => completeItem(item, now)), items.some((list) => list.length >= WINDOW)), failedProviders: failed };
}

/** Whether a query is exactly "what waits on me", so the header counts can be read off the list itself. */
export function isUnfilteredWaiting(query: ApprovalQuery): boolean {
  return (
    query.tab === "waiting" &&
    !query.cursor &&
    query.provider.length === 0 &&
    query.priority.length === 0 &&
    query.dueState.length === 0 &&
    !query.projectId &&
    !query.requesterId &&
    !query.q &&
    !query.from &&
    !query.to &&
    query.amountMin === undefined &&
    query.amountMax === undefined
  );
}

export type QueueRead = {
  /** The page asked for, in the list's own order. */
  page: UnifiedApprovalItem[];
  nextCursor: string | null;
  /** Everything read, after the in-memory filters and before the cursor and page size. */
  items: UnifiedApprovalItem[];
  /** Which sources filled their window, in the order of the sources asked. */
  saturated: boolean[];
  windowed: boolean;
  failed: ApprovalProviderSummary[];
};

/**
 * Asks the sources for one view and merges what they answer into one ordered,
 * paged list. Every source contributes items ordered by the same total key
 * (date or urgency, then provider key, then approval id — ids are row ids, so
 * unique across companies as well), which is what lets one cursor resume the
 * merged list from any position, in one company or across several.
 */
export async function readQueue(sources: Source[], query: ApprovalQuery, now: Date): Promise<QueueRead> {
  const dateSorted = query.sort === "newest" || query.sort === "oldest";
  const filteredInMemory = query.priority.length > 0 || query.dueState.length > 0;
  // Date order with no in-memory filter merges exactly, page by page; anything else
  // is ordered over a bounded window of each source (§253).
  const exact = dateSorted && !filteredInMemory && query.tab !== "waiting";
  const cursor = decodeCursor(query.cursor, query.tab, query.sort);

  const providerQuery: ProviderQuery = {
    tab: query.tab,
    statuses: query.status,
    projectId: query.projectId,
    requesterId: query.requesterId,
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
    to: query.to ? new Date(`${query.to}T00:00:00.000Z`) : undefined,
    q: query.q,
    amountMin: query.amountMin,
    amountMax: query.amountMax,
    returned: query.returned,
    order: query.sort === "oldest" ? "asc" : "desc",
    after: exact && cursor ? { at: new Date(Number(cursor[0])), providerKey: String(cursor[1]), approvalId: String(cursor[2]) } : null,
    limit: exact ? query.limit + 1 : WINDOW,
    now,
  };

  const { items: perSource, failed } = await askSources(sources, providerQuery);
  const saturated = perSource.map((rows) => !exact && rows.length >= WINDOW);
  const windowed = saturated.some(Boolean);

  let items = perSource.flat().map((item) => completeItem(item, now));
  if (query.priority.length > 0) items = items.filter((item) => query.priority.includes(item.priority));
  if (query.dueState.length > 0) items = items.filter((item) => query.dueState.includes(item.dueState));
  const ordered = afterCursor(sortItems(items, query.sort), query.sort, cursor);
  const page = ordered.slice(0, query.limit);
  const nextCursor = ordered.length > query.limit ? encodeCursor(query.tab, query.sort, sortKey(page[page.length - 1], query.sort)) : null;
  return { page, nextCursor, items, saturated, windowed, failed };
}

export async function listApprovals(context: UserContext, query: ApprovalQuery, options: Options = {}): Promise<ApprovalQueueResult> {
  assertCenter(context);
  const started = Date.now();
  const registry = options.registry ?? approvalProviders;
  const now = options.now ?? new Date();
  const enabled = registry.getEnabledProviders(context);
  const canViewHistory = can(context, "approvals.history.view");
  const selected = query.provider.length > 0 ? enabled.filter((provider) => query.provider.includes(provider.key)) : enabled;

  const base = {
    providers: enabled.map(summary),
    canViewHistory,
    canManageDelegation: can(context, "approvals.delegation.manage"),
  };
  if (query.tab === "history" && !canViewHistory) {
    return { ...base, items: [], nextCursor: null, counts: await getApprovalCounts(context, options), failedProviders: [], windowed: false };
  }

  const read = await readQueue(
    selected.map((provider) => ({ context, provider })),
    query,
    now,
  );

  // The header counts are always the unfiltered "waiting for me" (§96): reuse this
  // read when it was exactly that, otherwise ask for it.
  const counts = isUnfilteredWaiting(query) ? countsOf(read.items, read.windowed) : await getApprovalCounts(context, options);

  incrementCounter(Metric.APPROVALS_QUEUE, { tab: query.tab });
  incrementCounter(Metric.APPROVALS_QUEUE_DURATION_MS, { tab: query.tab }, Date.now() - started);

  return { ...base, items: read.page, nextCursor: read.nextCursor, counts, failedProviders: read.failed, windowed: read.windowed };
}

export async function getApprovalDetail(context: UserContext, providerKey: string, approvalId: string, options: Options = {}): Promise<UnifiedApprovalDetail> {
  assertCenter(context);
  const registry = options.registry ?? approvalProviders;
  const provider = registry.getProvider(providerKey);
  // A module switched off takes its approvals with it; a deep link is not a way back in (§198, §232).
  if (!provider.available(context)) throw providerUnavailable();
  const detail = await provider.detail(context, approvalId);
  if (!detail) throw approvalError("APPROVAL_NOT_FOUND", "You no longer have access to this approval.", "NOT_FOUND");
  return { ...detail, item: completeItem(detail.item, options.now ?? new Date()) };
}

/**
 * The approval behind a record, for a notification or attention link that
 * names the record (§42): `provider:approvalId`, or null when the reader has
 * no approval on it they can open.
 */
export async function findApprovalForRecord(context: UserContext, recordType: string, recordId: string, options: Options = {}): Promise<string | null> {
  if (!can(context, "approvals.view")) return null;
  const registry = options.registry ?? approvalProviders;
  for (const provider of registry.getEnabledProviders(context)) {
    if (!provider.recordTypes.includes(recordType as never)) continue;
    const approvalId = await provider.findByRecord(context, recordType, recordId).catch(() => null);
    if (approvalId && (await provider.detail(context, approvalId).catch(() => null))) return `${provider.key}:${approvalId}`;
  }
  return null;
}

const DECISION_OUTCOME: Record<ApprovalDecision, string> = { APPROVE: "APPROVED", REJECT: "REJECTED", RETURN: "RETURNED" };

/**
 * Routes one decision to the provider that owns it (§116-§125).
 *
 * The provider re-reads the approval and the module decides inside its own
 * transaction; nothing from the drawer is trusted. A retry carrying the same
 * idempotency key replays the first answer; the same person repeating the
 * same decision without one is told it was already made rather than refused.
 */
export async function decideApproval(
  context: UserContext,
  providerKey: string,
  approvalId: string,
  decision: ApprovalDecision,
  input: { note: string | null; expectedVersion?: number },
  options: Options & { idempotencyKey?: string | null } = {},
): Promise<ApprovalDecisionResult> {
  assertCenter(context);
  // Reject and Return always say why (PRD #41 §45, §206, §207) — enforced here, not only by the route.
  if (decision !== "APPROVE" && !input.note?.trim()) {
    throw approvalError("APPROVAL_REASON_REQUIRED", "Give a reason.", "VALIDATION_ERROR");
  }
  const registry = options.registry ?? approvalProviders;
  const provider = registry.getProvider(providerKey);
  if (!provider.available(context)) throw providerUnavailable();

  const key = options.idempotencyKey ?? null;
  if (key) {
    const receipt = await prisma.approvalDecisionReceipt.findUnique({
      where: { companyId_memberId_idempotencyKey: { companyId: context.companyId, memberId: context.membershipId, idempotencyKey: key } },
    });
    if (receipt) {
      if (receipt.providerKey !== providerKey || receipt.approvalId !== approvalId || receipt.decision !== decision) {
        throw approvalError("APPROVAL_IDEMPOTENCY_KEY_REUSED", "That request key was already used for a different decision.");
      }
      return { outcome: receipt.outcome as ApprovalDecisionResult["outcome"], alreadyApplied: true, item: await refreshedItem(context, provider, approvalId, options.now) };
    }
  }

  let result: Awaited<ReturnType<ApprovalProvider["decide"]>>;
  try {
    result = await provider.decide(context, approvalId, decision, input);
  } catch (error) {
    const code = error instanceof AccessError ? ((error.details as { code?: string } | undefined)?.code ?? error.code) : "INTERNAL_ERROR";
    incrementCounter(error instanceof AccessError && error.code === "CONFLICT" ? Metric.APPROVAL_CONFLICT : Metric.APPROVAL_DECISION_FAILURE, { provider: providerKey, decision });
    logger.warn("approvals.decision.refused", { providerKey, approvalId, decision, companyId: context.companyId, memberId: context.membershipId, code });
    throw error;
  }

  if (key && !result.alreadyApplied) {
    try {
      await prisma.approvalDecisionReceipt.create({
        data: { companyId: context.companyId, memberId: context.membershipId, idempotencyKey: key, providerKey, approvalId, decision, outcome: result.outcome },
      });
    } catch (error) {
      // A concurrent retry with the same key already wrote it; the decision itself happened once.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }

  incrementCounter(Metric.APPROVAL_DECISION_SUCCESS, { provider: providerKey, decision });
  logger.info("approvals.decision", {
    providerKey,
    approvalId,
    decision,
    outcome: result.outcome,
    expected: DECISION_OUTCOME[decision],
    alreadyApplied: result.alreadyApplied,
    companyId: context.companyId,
    memberId: context.membershipId,
  });
  return { ...result, item: await refreshedItem(context, provider, approvalId, options.now) };
}

async function refreshedItem(context: UserContext, provider: ApprovalProvider, approvalId: string, now?: Date): Promise<UnifiedApprovalItem | null> {
  const detail = await provider.detail(context, approvalId).catch(() => null);
  return detail ? completeItem(detail.item, now ?? new Date()) : null;
}
