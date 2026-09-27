import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, searchClause, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { buildLeadScopeWhere, buildLeadUnionWhere } from "../sales.scope";
import type { LeadListQuery, LeadSortKey } from "./lead.schema";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/** Lead queries (PRD #17 §36–§40, §245, §246). */

const ORDER: Record<LeadSortKey, Prisma.LeadOrderByWithRelationInput[]> = {
  "updated-desc": [{ updatedAt: "desc" }],
  "created-desc": [{ createdAt: "desc" }],
  "name-asc": [{ name: "asc" }],
  "value-desc": [{ estimatedValue: { sort: "desc", nulls: "last" } }],
  "status-asc": [{ status: "asc" }, { updatedAt: "desc" }],
  "owner-asc": [{ owner: { user: { lastName: "asc" } } }, { updatedAt: "desc" }],
};

/**
 * Owner is joined, never fetched per row (PRD #17 §246, §343).
 */
const OWNER_SELECT = {
  id: true,
  status: true,
  user: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CompanyMemberSelect;

export const SUMMARY_SELECT = {
  id: true,
  name: true,
  companyName: true,
  email: true,
  phone: true,
  source: true,
  status: true,
  estimatedValue: true,
  currency: true,
  updatedAt: true,
  owner: { select: OWNER_SELECT },
} satisfies Prisma.LeadSelect;

export type LeadRow = Prisma.LeadGetPayload<{ select: typeof SUMMARY_SELECT }>;

/** A group row also says whose it is, so the service can label it (Workspace Context §45). */
export const GROUP_SUMMARY_SELECT = { ...SUMMARY_SELECT, companyId: true } satisfies Prisma.LeadSelect;

export type GroupLeadRow = Prisma.LeadGetPayload<{ select: typeof GROUP_SUMMARY_SELECT }>;

export const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  website: true,
  notes: true,
  disqualifyReason: true,
  preArchiveStatus: true,
  convertedAt: true,
  convertedClientId: true,
  archivedAt: true,
  createdAt: true,
  createdByMemberId: true,
  ownerMemberId: true,
  convertedClient: { select: { id: true, name: true } },
  convertedOpportunity: { select: { id: true, name: true } },
} satisfies Prisma.LeadSelect;

export type LeadDetailRow = Prisma.LeadGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * Everything a list narrows by other than the scope. `mine` is the reader's own
 * membership, and a group reader has one per company: their own leads in each.
 */
function leadFilters(query: LeadListQuery, mineMemberIds: string[]): Prisma.LeadWhereInput[] {
  const filters: Prisma.LeadWhereInput[] = [];

  // Archived leads are absent unless asked for, and ARCHIVED is not a status
  // anyone can filter into by accident (PRD #17 §57).
  filters.push(
    query.archived ? { status: "ARCHIVED" } : { archivedAt: null, status: { not: "ARCHIVED" } },
  );

  const search = searchClause(query.search, ["name", "companyName", "email", "phone"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.LeadWhereInput),
        // Searching an owner's name is fine: the scope clause above already
        // decided which leads are reachable (PRD #17 §221).
        { owner: { user: { firstName: { contains: term, mode: "insensitive" } } } },
        { owner: { user: { lastName: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (query.status?.length && !query.archived) filters.push({ status: { in: query.status } });
  if (query.source?.length) filters.push({ source: { in: query.source } });
  if (query.mine) filters.push({ ownerMemberId: mineMemberIds.length === 1 ? mineMemberIds[0] : { in: mineMemberIds } });
  else if (query.ownerMemberId) filters.push({ ownerMemberId: query.ownerMemberId });
  if (query.currency) filters.push({ currency: query.currency });
  if (query.minValue) filters.push({ estimatedValue: { gte: new Prisma.Decimal(query.minValue) } });
  if (query.maxValue) filters.push({ estimatedValue: { lte: new Prisma.Decimal(query.maxValue) } });
  if (query.createdFrom) filters.push({ createdAt: { gte: query.createdFrom } });
  if (query.createdTo) filters.push({ createdAt: { lte: query.createdTo } });

  return filters;
}

export function buildLeadListWhere(
  context: UserContext,
  query: LeadListQuery,
): Prisma.LeadWhereInput {
  return { AND: [buildLeadScopeWhere(context), ...leadFilters(query, [context.membershipId])] };
}

/** The Group workspace's list: the union of each company's own scope, then the same filters (§58). */
export function buildLeadGroupWhere(contexts: UserContext[], query: LeadListQuery): Prisma.LeadWhereInput {
  return {
    AND: [buildLeadUnionWhere(contexts), ...leadFilters(query, contexts.map((context) => context.membershipId))],
  };
}

export async function listLeads(context: UserContext, query: LeadListQuery) {
  const where = buildLeadListWhere(context, query);

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "sales.leads.list",
    async (tx) => {
      const window = pageWindow(await tx.lead.count({ where }), query.page, query.limit);
      const rows = await tx.lead.findMany({
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

/** One page of the group's leads, the id breaking ties so a page boundary between two companies is stable. */
export async function listLeadsInGroup(contexts: UserContext[], query: LeadListQuery) {
  const where = buildLeadGroupWhere(contexts, query);

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "sales.leads.group-list",
    async (tx) => {
      const window = pageWindow(await tx.lead.count({ where }), query.page, query.limit);
      const rows = await tx.lead.findMany({
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

export function findLeadInScope(context: UserContext, leadId: string) {
  return prisma.lead.findFirst({
    where: { AND: [buildLeadScopeWhere(context), { id: leadId }] },
    select: DETAIL_SELECT,
  });
}

/**
 * Filter options drawn from the leads this reader can already see
 * (PRD #17 §222, §337).
 */
export async function leadFilterOptions(context: UserContext) {
  const scope = buildLeadScopeWhere(context);

  const [owners, currencies] = await Promise.all([
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, ownedLeads: { some: scope } },
      select: OWNER_SELECT,
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    }),
    prisma.lead.findMany({
      where: { AND: [scope, { currency: { not: null } }] },
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
    currencies: currencies.map((row) => row.currency).filter((code): code is string => Boolean(code)),
  };
}

/**
 * The group list's filter options, drawn from the leads the reader can already
 * see in each company they read. An owner is one company's membership, so it
 * carries its company.
 */
export async function leadFilterOptionsInGroup(contexts: UserContext[]) {
  const [owners, currencies] = await Promise.all([
    prisma.companyMember.findMany({
      where: {
        OR: contexts.map((context) => ({
          companyId: context.companyId,
          ownedLeads: { some: buildLeadScopeWhere(context) },
        })),
      },
      select: { ...OWNER_SELECT, companyId: true },
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    }),
    prisma.lead.findMany({
      where: { AND: [buildLeadUnionWhere(contexts), { currency: { not: null } }] },
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
    currencies: currencies.map((row) => row.currency).filter((code): code is string => Boolean(code)),
  };
}
