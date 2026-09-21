import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { buildOpportunityScopeWhere, buildOpportunityUnionWhere } from "../sales.scope";
import { CLOSED_STAGES, OPEN_STAGES } from "./opportunity.stage";
import type { OpportunityListQuery, OpportunitySortKey } from "./opportunity.schema";

/** Opportunity queries (PRD #17 §71–§74, §245–§247). */

const OWNER_SELECT = {
  id: true,
  status: true,
  user: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CompanyMemberSelect;

/**
 * Weighted value is not a column, so it cannot be a SQL sort key. The list
 * orders by estimate and the service re-orders the page by the derived figure —
 * honest about being a page-level sort, and correct for what the reader sees.
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
  if (query.minValue) filters.push({ estimatedValue: { gte: new Prisma.Decimal(query.minValue) } });
  if (query.maxValue) filters.push({ estimatedValue: { lte: new Prisma.Decimal(query.maxValue) } });
  if (query.closeFrom) filters.push({ expectedCloseDate: { gte: query.closeFrom } });
  if (query.closeTo) filters.push({ expectedCloseDate: { lte: query.closeTo } });

  return filters;
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

  const [rows, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      orderBy: ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SUMMARY_SELECT,
    }),
    prisma.opportunity.count({ where }),
  ]);

  return { rows, total };
}

/**
 * One page of the group's opportunities. The sort is the list's own, applied
 * across companies in the database, and the id breaks ties so a page boundary
 * never repeats or drops a row between two companies' equal values.
 */
export async function listOpportunitiesInGroup(contexts: UserContext[], query: OpportunityListQuery) {
  const where = buildOpportunityGroupWhere(contexts, query);

  const [rows, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      orderBy: [...ORDER[query.sort], { id: "asc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: GROUP_SUMMARY_SELECT,
    }),
    prisma.opportunity.count({ where }),
  ]);

  return { rows, total };
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
