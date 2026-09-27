import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, searchClause, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { buildOpportunityScopeWhere, buildOpportunityUnionWhere } from "../sales.scope";
import { CLOSED_STAGES, effectiveProbability, getDefaultStageProbability, OPEN_STAGES, OPPORTUNITY_STAGES } from "./opportunity.stage";
import type { OpportunityListQuery, OpportunitySortKey } from "./opportunity.schema";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/** Opportunity queries (PRD #17 §71–§74, §245–§247). */

const OWNER_SELECT = {
  id: true,
  status: true,
  user: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CompanyMemberSelect;

/**
 * The column sorts (AUD-08 §4, DT-04). Weighted value and probability are
 * derived, so `weighted-desc` and `probability-desc` are ordered over every
 * match by `derivedPage` below — never a re-sort of one page, which put the
 * largest weighted deal of page 2 below the smallest of page 1. Each order ends
 * in the id; close date goes last when there is none.
 */
const ORDER: Record<OpportunitySortKey, Prisma.OpportunityOrderByWithRelationInput[]> = {
  "updated-desc": [{ updatedAt: "desc" }],
  "close-asc": [{ expectedCloseDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
  "value-desc": [{ estimatedValue: "desc" }],
  "weighted-desc": [{ estimatedValue: "desc" }],
  "probability-desc": [{ stage: "desc" }, { estimatedValue: "desc" }],
  "stage-asc": [{ stage: "asc" }, { updatedAt: "desc" }],
  "name-asc": [{ name: "asc" }],
};

export const SUMMARY_SELECT = {
  id: true,
  name: true,
  stage: true,
  estimatedValue: true,
  currency: true,
  probabilityOverride: true,
  expectedCloseDate: true,
  nextStep: true,
  updatedAt: true,
  client: { select: { id: true, name: true } },
  owner: { select: OWNER_SELECT },
} satisfies Prisma.OpportunitySelect;

export type OpportunityRow = Prisma.OpportunityGetPayload<{ select: typeof SUMMARY_SELECT }>;

/** A group row also says whose it is, so the service can label it (Workspace Context §45). */
export const GROUP_SUMMARY_SELECT = { ...SUMMARY_SELECT, companyId: true } satisfies Prisma.OpportunitySelect;

export type GroupOpportunityRow = Prisma.OpportunityGetPayload<{ select: typeof GROUP_SUMMARY_SELECT }>;

export const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  clientId: true,
  contactId: true,
  ownerMemberId: true,
  description: true,
  actualCloseDate: true,
  stageChangedAt: true,
  preArchiveStage: true,
  sourceLeadId: true,
  convertedProjectId: true,
  wonReason: true,
  lostReason: true,
  lostNote: true,
  archivedAt: true,
  createdAt: true,
  createdByMemberId: true,
  contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  sourceLead: { select: { id: true, name: true } },
  convertedProject: { select: { id: true, code: true, name: true } },
  // Batched with the record rather than counted per render (PRD #17 §248).
  _count: { select: { proposals: true } },
} satisfies Prisma.OpportunitySelect;

export type OpportunityDetailRow = Prisma.OpportunityGetPayload<{
  select: typeof DETAIL_SELECT;
}>;

/**
 * Everything a list narrows by other than the scope. `mine` is the reader's own
 * membership, and a group reader has one per company: their own deals in each.
 */
function opportunityFilters(query: OpportunityListQuery, mineMemberIds: string[]): Prisma.OpportunityWhereInput[] {
  const filters: Prisma.OpportunityWhereInput[] = [];

  filters.push(query.archived ? { archivedAt: { not: null } } : { archivedAt: null });

  const search = searchClause(query.search, ["name", "nextStep", "description"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.OpportunityWhereInput),
        { client: { name: { contains: term, mode: "insensitive" } } },
        { owner: { user: { firstName: { contains: term, mode: "insensitive" } } } },
        { owner: { user: { lastName: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (query.stage?.length) filters.push({ stage: { in: query.stage } });

  if (query.outcome?.length) {
    const stages = new Set<Prisma.OpportunityWhereInput["stage"] extends never ? never : string>();
    for (const outcome of query.outcome) {
      if (outcome === "OPEN") for (const stage of OPEN_STAGES) stages.add(stage);
      if (outcome === "WON") stages.add("WON");
      if (outcome === "LOST") stages.add("LOST");
    }
    filters.push({ stage: { in: [...stages] as OpportunityListQuery["stage"] } });
  }

  if (query.mine) filters.push({ ownerMemberId: mineMemberIds.length === 1 ? mineMemberIds[0] : { in: mineMemberIds } });
  else if (query.ownerMemberId) filters.push({ ownerMemberId: query.ownerMemberId });
  if (query.clientId) filters.push({ clientId: query.clientId });
  if (query.currency) filters.push({ currency: query.currency });
  // Probability is the override when set, else the stage's default: a filter the database can apply
  // before the count and the page (AUD-08 §3, DT-03) — it used to trim the page after it was read.
  if (query.minProbability !== undefined) filters.push(probabilityWhere("gte", query.minProbability));
  if (query.maxProbability !== undefined) filters.push(probabilityWhere("lte", query.maxProbability));
  if (query.minValue) filters.push({ estimatedValue: { gte: new Prisma.Decimal(query.minValue) } });
  if (query.maxValue) filters.push({ estimatedValue: { lte: new Prisma.Decimal(query.maxValue) } });
  if (query.closeFrom) filters.push({ expectedCloseDate: { gte: query.closeFrom } });
  if (query.closeTo) filters.push({ expectedCloseDate: { lte: query.closeTo } });

  return filters;
}

/** `effectiveProbability` as a `where`: the override when there is one, else the stage default. */
function probabilityWhere(op: "gte" | "lte", bound: number): Prisma.OpportunityWhereInput {
  const stages = OPPORTUNITY_STAGES.filter((stage) =>
    op === "gte" ? getDefaultStageProbability(stage) >= bound : getDefaultStageProbability(stage) <= bound,
  );
  return {
    OR: [
      { probabilityOverride: { [op]: new Prisma.Decimal(bound) } },
      { probabilityOverride: null, stage: { in: stages } },
    ],
  };
}

const DERIVED_SORTS: ReadonlySet<OpportunitySortKey> = new Set(["weighted-desc", "probability-desc"]);

/**
 * One page of a derived sort, from one snapshot: every matching deal's stage,
 * override and estimate is read (ids and three columns, no row cap), ordered by
 * the derived figure in Decimal — weighted value or probability, highest first,
 * then the estimate, then the id — and only the page's rows are read in full.
 * The figures are compared as raw numbers; like the column sorts, a sort does
 * not convert currencies.
 */
async function derivedPageIds(tx: Prisma.TransactionClient, where: Prisma.OpportunityWhereInput, query: OpportunityListQuery) {
  const candidates = await tx.opportunity.findMany({
    where,
    orderBy: [{ estimatedValue: "desc" }, { id: "asc" }],
    select: { id: true, stage: true, probabilityOverride: true, estimatedValue: true },
  });
  const key = (row: (typeof candidates)[number]) => {
    const probability = effectiveProbability(row.stage, row.probabilityOverride);
    return query.sort === "weighted-desc" ? new Prisma.Decimal(row.estimatedValue).times(probability) : probability;
  };
  const keyed = candidates.map((row) => ({ id: row.id, key: key(row) }));
  // Array.prototype.sort is stable: equal figures keep the estimate-then-id order.
  keyed.sort((a, b) => b.key.comparedTo(a.key));
  const window = pageWindow(keyed.length, query.page, query.limit);
  const ids = keyed.slice(skipFor(window.page, window.limit), skipFor(window.page, window.limit) + window.limit).map((row) => row.id);
  return { ids, window };
}

/** Rows read by id, put back in the order the ids were ranked. */
function inOrder<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export function buildOpportunityListWhere(
  context: UserContext,
  query: OpportunityListQuery,
): Prisma.OpportunityWhereInput {
  return { AND: [buildOpportunityScopeWhere(context), ...opportunityFilters(query, [context.membershipId])] };
}

/** The Group workspace's list: the union of each company's own scope, then the same filters (§58). */
export function buildOpportunityGroupWhere(
  contexts: UserContext[],
  query: OpportunityListQuery,
): Prisma.OpportunityWhereInput {
  return {
    AND: [
      buildOpportunityUnionWhere(contexts),
      ...opportunityFilters(query, contexts.map((context) => context.membershipId)),
    ],
  };
}

export async function listOpportunities(context: UserContext, query: OpportunityListQuery) {
  const where = buildOpportunityListWhere(context, query);

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "sales.opportunities.list",
    async (tx) => {
      if (DERIVED_SORTS.has(query.sort)) {
        const { ids, window } = await derivedPageIds(tx, where, query);
        return { rows: inOrder(ids, await tx.opportunity.findMany({ where: { id: { in: ids } }, select: SUMMARY_SELECT })), window };
      }
      const window = pageWindow(await tx.opportunity.count({ where }), query.page, query.limit);
      const rows = await tx.opportunity.findMany({
        where,
        orderBy: withTieBreaker(ORDER[query.sort]),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: SUMMARY_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  return { rows, total: window.total, window };
}

/**
 * One page of the group's opportunities. The sort is the list's own, applied
 * across companies in the database, and the id breaks ties so a page boundary
 * never repeats or drops a row between two companies' equal values.
 */
export async function listOpportunitiesInGroup(contexts: UserContext[], query: OpportunityListQuery) {
  const where = buildOpportunityGroupWhere(contexts, query);

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "sales.opportunities.group-list",
    async (tx) => {
      if (DERIVED_SORTS.has(query.sort)) {
        const { ids, window } = await derivedPageIds(tx, where, query);
        return { rows: inOrder(ids, await tx.opportunity.findMany({ where: { id: { in: ids } }, select: GROUP_SUMMARY_SELECT })), window };
      }
      const window = pageWindow(await tx.opportunity.count({ where }), query.page, query.limit);
      const rows = await tx.opportunity.findMany({
        where,
        orderBy: withTieBreaker(ORDER[query.sort]),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: GROUP_SUMMARY_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  return { rows, total: window.total, window };
}

export function findOpportunityInScope(context: UserContext, opportunityId: string) {
  return prisma.opportunity.findFirst({
    where: { AND: [buildOpportunityScopeWhere(context), { id: opportunityId }] },
    select: DETAIL_SELECT,
  });
}

/** Open opportunities for one stage column of the pipeline board (PRD #17 §247). */
export function listStageOpportunities(
  context: UserContext,
  stage: OpportunityListQuery["stage"] extends undefined ? never : string,
  take: number,
) {
  return prisma.opportunity.findMany({
    where: {
      AND: [
        buildOpportunityScopeWhere(context),
        { archivedAt: null, stage: stage as OpportunityRow["stage"] },
      ],
    },
    orderBy: [{ estimatedValue: "desc" }],
    take,
    select: SUMMARY_SELECT,
  });
}

/**
 * A stage column of the group's board: the stage's deals across every company,
 * largest first, the id keeping the order stable between reads.
 */
export function listStageOpportunitiesInGroup(
  contexts: UserContext[],
  stage: OpportunityListQuery["stage"] extends undefined ? never : string,
  take: number,
) {
  return prisma.opportunity.findMany({
    where: {
      AND: [
        buildOpportunityUnionWhere(contexts),
        { archivedAt: null, stage: stage as OpportunityRow["stage"] },
      ],
    },
    orderBy: [{ estimatedValue: "desc" }, { id: "asc" }],
    take,
    select: GROUP_SUMMARY_SELECT,
  });
}

/** Every open opportunity in scope, for the aggregates the board headers show. */
export function openOpportunityAggregateRows(context: UserContext) {
  return openOpportunityAggregateRowsIn(buildOpportunityScopeWhere(context));
}

/** The same rows for any scope: one company's, or the union a group reads. */
export function openOpportunityAggregateRowsIn(scope: Prisma.OpportunityWhereInput) {
  return prisma.opportunity.findMany({
    where: {
      AND: [scope, { archivedAt: null, stage: { in: OPEN_STAGES } }],
    },
    select: {
      stage: true,
      currency: true,
      estimatedValue: true,
      probabilityOverride: true,
    },
  });
}

/** Closed opportunities in a period, for win rate and outcome reports. */
export function closedOpportunityRows(context: UserContext, from: Date, to: Date) {
  return closedOpportunityRowsIn(buildOpportunityScopeWhere(context), from, to);
}

export function closedOpportunityRowsIn(scope: Prisma.OpportunityWhereInput, from: Date, to: Date) {
  return prisma.opportunity.findMany({
    where: {
      AND: [
        scope,
        { stage: { in: CLOSED_STAGES }, actualCloseDate: { gte: from, lte: to } },
      ],
    },
    select: {
      stage: true,
      currency: true,
      estimatedValue: true,
      probabilityOverride: true,
      lostReason: true,
      ownerMemberId: true,
      // Which company's membership the owner is, for the group's owner report.
      companyId: true,
      owner: { select: OWNER_SELECT },
    },
  });
}

export async function opportunityFilterOptions(context: UserContext) {
  const scope = buildOpportunityScopeWhere(context);

  const [owners, clients, currencies] = await Promise.all([
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, ownedOpportunities: { some: scope } },
      select: OWNER_SELECT,
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    }),
    prisma.client.findMany({
      where: { companyId: context.companyId, opportunities: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.opportunity.findMany({
      where: scope,
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return {
    owners: owners.map((owner) => ({
      memberId: owner.id,
      fullName: `${owner.user.firstName} ${owner.user.lastName}`,
      active: owner.status === "ACTIVE",
    })),
    clients,
    currencies: currencies.map((row) => row.currency),
  };
}

/**
 * The group list's filter options, drawn — as the company's are — from the
 * opportunities the reader can already see, in each company they read. An owner
 * or a client is one company's record, so it carries its company: two people
 * called the same in two companies are two different options.
 */
export async function opportunityFilterOptionsInGroup(contexts: UserContext[]) {
  const scopes = contexts.map((context) => ({ context, scope: buildOpportunityScopeWhere(context) }));

  const [owners, clients, currencies] = await Promise.all([
    prisma.companyMember.findMany({
      where: { OR: scopes.map(({ context, scope }) => ({ companyId: context.companyId, ownedOpportunities: { some: scope } })) },
      select: { ...OWNER_SELECT, companyId: true },
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    }),
    prisma.client.findMany({
      where: { OR: scopes.map(({ context, scope }) => ({ companyId: context.companyId, opportunities: { some: scope } })) },
      select: { id: true, name: true, companyId: true },
      orderBy: { name: "asc" },
    }),
    prisma.opportunity.findMany({
      where: buildOpportunityUnionWhere(contexts),
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return {
    owners: owners.map((owner) => ({
      memberId: owner.id,
      companyId: owner.companyId,
      fullName: `${owner.user.firstName} ${owner.user.lastName}`,
      active: owner.status === "ACTIVE",
    })),
    clients,
    currencies: currencies.map((row) => row.currency),
  };
}
