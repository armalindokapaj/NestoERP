import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { completeItem } from "./approvals.order";
import { approvalProviders, type ApprovalProviderRegistry } from "./approvals.registry";
import type { ApprovalQuery } from "./approvals.schema";
import {
  askSources,
  countsOf,
  getApprovalCounts,
  type CountsResult,
  isUnfilteredWaiting,
  listApprovals,
  readQueue,
  sourceSaturated,
  summary,
  waitingQuery,
  type Source,
} from "./approvals.service";
import type { ApprovalCompany, ApprovalCompanyCounts, ApprovalCounts, ApprovalProviderSummary, ApprovalQueueResult, UnifiedApprovalItem } from "./approvals.types";

/**
 * The Approvals Center in the Group workspace (Workspace Context §33, §45, §73).
 *
 * "Waiting for me" in the group is what waits for this person in each company
 * they may decide in — not one company's queue with its boundary taken off.
 * So the group list is a fan-out: the Center's own read, run once per company
 * with that company's own context (`resolveWorkspaceContexts`, which is the same
 * context a sign-in there would give), then merged. Each company's providers
 * apply that company's scope, grants, delegations and separation-of-duties,
 * so the group can only ever show what a company page would show them (§57, §62).
 *
 * The merge is the Center's own: the same tabs, filters, sorts and cursor. A
 * position in the merged list is the sort key of its last item, and the keys end
 * in provider key and approval id — the row's own id, unique across companies —
 * so one cursor resumes the list across every company and no page repeats or
 * skips an item. Nothing about a company is in the cursor, and nothing in it
 * grants anything: a resumed read asks each company's rules again.
 *
 * The Group view is a read. Deciding, returning and delegating belong to one
 * company's workspace, opened from the row (§74), so none of them is offered here.
 */

type Options = { registry?: ApprovalProviderRegistry; now?: Date };

const companyOf = (context: UserContext): ApprovalCompany => ({ id: context.companyId, name: context.company.name });

/** The companies whose approvals this person may read, in name order: the same order every list and count uses. */
async function readableContexts(session: UserContext): Promise<UserContext[]> {
  const contexts = await resolveWorkspaceContexts(session, { module: "approvals", permission: "approvals.view" });
  return [...contexts].sort((a, b) => a.company.name.localeCompare(b.company.name) || a.companyId.localeCompare(b.companyId));
}

function sourcesOf(contexts: UserContext[], registry: ApprovalProviderRegistry, only: string[]): Source[] {
  return contexts.flatMap((context) => {
    const company = companyOf(context);
    return registry
      .getEnabledProviders(context)
      .filter((provider) => only.length === 0 || only.includes(provider.key))
      .map((provider) => ({ context, provider, company }));
  });
}

/**
 * Each company's own figures and their sum, so the header and the breakdown can
 * never disagree. A company with a source that could not be read is partial, and
 * so is the sum: the header names what is missing instead of totalling it as
 * nothing (AUD-10 §4, CW-03).
 */
function countsByCompany(companies: ApprovalCompany[], items: UnifiedApprovalItem[], saturated: Set<string>, failed: ApprovalProviderSummary[]): ApprovalCounts {
  const byCompany: ApprovalCompanyCounts[] = companies.map((company) => {
    const { waiting, overdue, critical, capped } = countsOf(
      items.filter((item) => item.company?.id === company.id),
      saturated.has(company.id),
    );
    return { company, waiting, overdue, critical, capped, partial: failed.some((source) => source.company?.id === company.id) };
  });
  return {
    waiting: byCompany.reduce((sum, row) => sum + row.waiting, 0),
    overdue: byCompany.reduce((sum, row) => sum + row.overdue, 0),
    critical: byCompany.reduce((sum, row) => sum + row.critical, 0),
    capped: byCompany.some((row) => row.capped),
    partial: failed.length > 0,
    unavailable: failed,
    byCompany,
  };
}

function saturatedCompanies(sources: Source[], saturated: boolean[]): Set<string> {
  return new Set(sources.flatMap((source, index) => (saturated[index] && source.company ? [source.company.id] : [])));
}

const NO_COUNTS: ApprovalCounts = { waiting: 0, overdue: 0, critical: 0, capped: false, partial: false, unavailable: [], byCompany: [] };

async function groupCounts(contexts: UserContext[], registry: ApprovalProviderRegistry, now: Date): Promise<CountsResult> {
  const sources = sourcesOf(contexts, registry, []);
  const { items, failed, windowed } = await askSources(sources, waitingQuery(now));
  return {
    ...countsByCompany(
      contexts.map(companyOf),
      items.flat().map((item) => completeItem(item, now)),
      saturatedCompanies(sources, sourceSaturated(items, windowed)),
      failed,
    ),
    failedProviders: failed,
  };
}

function withoutAlias(result: CountsResult): ApprovalCounts {
  const counts: ApprovalCounts & { failedProviders?: unknown } = { ...result };
  delete counts.failedProviders;
  return counts;
}

/**
 * What waits on this person, per company and in all (§33). A company workspace
 * answers exactly as before.
 */
export async function getApprovalCountsForWorkspace(session: UserContext, options: Options = {}): Promise<CountsResult> {
  if (!inGroupWorkspace(session)) return getApprovalCounts(session, options);
  const contexts = await readableContexts(session);
  if (contexts.length === 0) return { ...NO_COUNTS, failedProviders: [] };
  return groupCounts(contexts, options.registry ?? approvalProviders, options.now ?? new Date());
}

/**
 * The queue for the active workspace: a company's own list, unchanged, or the
 * group's merge of every company's (§45). A group list carries each item's
 * company; `query.company` narrows it to one company the person may read and a
 * company outside those finds nothing, whatever the request says (§57, §87).
 */
export async function listApprovalsForWorkspace(session: UserContext, query: ApprovalQuery, options: Options = {}): Promise<ApprovalQueueResult> {
  if (!inGroupWorkspace(session)) return listApprovals(session, query, options);

  const started = Date.now();
  const registry = options.registry ?? approvalProviders;
  const now = options.now ?? new Date();
  const contexts = await readableContexts(session);
  const companies = contexts.map(companyOf);

  const offered = new Set(contexts.flatMap((context) => registry.getEnabledProviders(context).map((provider) => provider.key)));
  const canViewHistory = contexts.some((context) => can(context, "approvals.history.view"));
  const base = {
    providers: registry.all().filter((provider) => offered.has(provider.key)).map(summary),
    canViewHistory,
    // Delegation is a company's own arrangement between its members.
    canManageDelegation: false,
    companies,
  };
  const empty = { items: [], nextCursor: null, failedProviders: [], windowed: false };
  if (contexts.length === 0) return { ...base, ...empty, counts: NO_COUNTS };
  if (query.tab === "history" && !canViewHistory) {
    const counts = await groupCounts(contexts, registry, now);
    return { ...base, ...empty, counts: withoutAlias(counts), failedProviders: counts.unavailable };
  }

  // The company filter can only choose among the companies already readable; the history tab
  // is each company's own grant, so a company that withholds it contributes nothing to it.
  const chosen = query.company ? contexts.filter((context) => context.companyId === query.company) : contexts;
  const reading = query.tab === "history" ? chosen.filter((context) => can(context, "approvals.history.view")) : chosen;
  const sources = sourcesOf(reading, registry, query.provider);
  const read = await readQueue(sources, query, now);

  // The header counts are always the unfiltered "waiting for me" in every company (§96),
  // whichever company the list is narrowed to: reuse this read when it was exactly that.
  const counts =
    isUnfilteredWaiting(query) && !query.company
      ? countsByCompany(companies, read.items, saturatedCompanies(sources, read.saturated), read.failed)
      : withoutAlias(await groupCounts(contexts, registry, now));

  incrementCounter(Metric.APPROVALS_QUEUE, { tab: query.tab });
  incrementCounter(Metric.APPROVALS_QUEUE_DURATION_MS, { tab: query.tab }, Date.now() - started);

  return { ...base, items: read.page, nextCursor: read.nextCursor, counts, failedProviders: read.failed, windowed: read.windowed };
}
