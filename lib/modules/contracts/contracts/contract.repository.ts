import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, searchClause, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import {
  buildOpportunityScopeWhere,
  buildProposalScopeWhere,
} from "@/lib/modules/sales/sales.scope";
import {
  buildContractClientWhere,
  buildContractOwnerWhere,
  buildContractProjectWhere,
  buildContractScopeWhere,
} from "../contract.scope";
import { EXPIRING_SOON_DAYS } from "./contract.status";
import type { ContractListQuery, ContractSortKey } from "./contract.schema";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Contract queries (PRD #18 §244, §300–§310).
 *
 * Repositories know Prisma and nothing about permissions. Every function takes
 * the caller's scope clause as its first filter, so a query written here cannot
 * accidentally reach outside it (PRD #18 §244).
 *
 * The list carries its client, project, owner and counts in the same round
 * trip: twenty-five contracts must not become a hundred queries
 * (PRD #18 §303, §449).
 */

const ORDER: Record<ContractSortKey, Prisma.ContractOrderByWithRelationInput[]> = {
  "updated-desc": [{ updatedAt: "desc" }],
  "created-desc": [{ createdAt: "desc" }],
  "number-asc": [{ contractNumber: "asc" }],
  "title-asc": [{ title: "asc" }],
  "effective-desc": [{ effectiveDate: { sort: "desc", nulls: "last" } }],
  "expiry-asc": [{ expiryDate: { sort: "asc", nulls: "last" } }],
  "value-desc": [{ contractValue: { sort: "desc", nulls: "last" } }],
  "status-asc": [{ status: "asc" }, { updatedAt: "desc" }],
};

export const SUMMARY_SELECT = {
  id: true,
  contractNumber: true,
  title: true,
  contractType: true,
  status: true,
  counterpartyName: true,
  currency: true,
  contractValue: true,
  effectiveDate: true,
  expiryDate: true,
  signedDate: true,
  renewalType: true,
  renewalNoticeDays: true,
  updatedAt: true,
  clientId: true,
  projectId: true,
  ownerMemberId: true,
  client: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  owner: {
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  },
  // Counted by the database rather than by loading the rows (PRD #18 §303).
  _count: { select: { obligations: { where: { status: "OPEN" } } } },
} satisfies Prisma.ContractSelect;

export type ContractRow = Prisma.ContractGetPayload<{ select: typeof SUMMARY_SELECT }>;

export const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  opportunityId: true,
  proposalId: true,
  preArchiveStatus: true,
  sentAt: true,
  autoRenewalPeriodMonths: true,
  governingLaw: true,
  jurisdiction: true,
  summary: true,
  commercialNotes: true,
  legalNotes: true,
  terminationDate: true,
  terminationReason: true,
  createdAt: true,
  createdByMemberId: true,
  archivedAt: true,
  opportunity: { select: { id: true, name: true } },
  proposal: { select: { id: true, proposalNumber: true, title: true } },
} satisfies Prisma.ContractSelect;

export type ContractDetailRow = Prisma.ContractGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;

/**
 * The named views (PRD #18 §87–§93).
 *
 * `expiring` is the only one that is not a plain status filter: it is ACTIVE
 * plus a horizon, computed from today rather than read from a column, which is
 * why there is no EXPIRING status to filter on (PRD #18 §75, §90).
 */
function viewFilter(query: ContractListQuery, today: Date): Prisma.ContractWhereInput {
  switch (query.view) {
    case "drafts":
      return { status: "DRAFT", archivedAt: null };
    case "review":
      return { status: { in: ["IN_REVIEW", "PENDING_APPROVAL"] }, archivedAt: null };
    case "active":
      return { status: "ACTIVE", archivedAt: null };
    case "expiring": {
      const within = query.expiringWithin ?? EXPIRING_SOON_DAYS;
      return {
        status: "ACTIVE",
        archivedAt: null,
        expiryDate: { gte: today, lte: new Date(today.getTime() + within * DAY) },
      };
    }
    case "expired":
      return { status: "EXPIRED", archivedAt: null };
    case "terminated":
      return { status: "TERMINATED", archivedAt: null };
    case "archived":
      return { archivedAt: { not: null } };
    default:
      return { archivedAt: null };
  }
}

export function buildContractListWhere(
  context: UserContext,
  query: ContractListQuery,
  today: Date,
): Prisma.ContractWhereInput {
  const filters: Prisma.ContractWhereInput[] = [
    buildContractScopeWhere(context),
    viewFilter(query, today),
  ];

  /*
   * Search reaches the linked records by name, never by a second query the
   * caller could use to confirm a client exists (PRD #18 §83, §296). The join
   * is inside the same scoped `where`, so a contract outside scope stays
   * invisible whatever the term matches.
   */
  const search = searchClause(query.search, ["contractNumber", "title", "counterpartyName"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.ContractWhereInput),
        { client: { name: { contains: term, mode: "insensitive" } } },
        { project: { name: { contains: term, mode: "insensitive" } } },
        {
          owner: {
            user: {
              OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.contractType?.length) filters.push({ contractType: { in: query.contractType } });
  if (query.renewalType?.length) filters.push({ renewalType: { in: query.renewalType } });
  if (query.clientId) filters.push({ clientId: query.clientId });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.ownerMemberId) filters.push({ ownerMemberId: query.ownerMemberId });
  if (query.currency) filters.push({ currency: query.currency });
  if (query.mine) filters.push({ ownerMemberId: context.membershipId });

  if (query.effectiveFrom) filters.push({ effectiveDate: { gte: query.effectiveFrom } });
  if (query.effectiveTo) filters.push({ effectiveDate: { lte: query.effectiveTo } });
  if (query.expiryFrom) filters.push({ expiryDate: { gte: query.expiryFrom } });
  if (query.expiryTo) filters.push({ expiryDate: { lte: query.expiryTo } });

  return { AND: filters };
}

export async function listContracts(
  context: UserContext,
  query: ContractListQuery,
  today: Date,
) {
  const where = buildContractListWhere(context, query, today);

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "contracts.list",
    async (tx) => {
      const window = pageWindow(await tx.contract.count({ where }), query.page, query.limit);
      const rows = await tx.contract.findMany({
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

export function findContractInScope(context: UserContext, contractId: string) {
  return prisma.contract.findFirst({
    where: { AND: [buildContractScopeWhere(context), { id: contractId }] },
    select: DETAIL_SELECT,
  });
}

export function findContractSummaryInScope(context: UserContext, contractId: string) {
  return prisma.contract.findFirst({
    where: { AND: [buildContractScopeWhere(context), { id: contractId }] },
    select: SUMMARY_SELECT,
  });
}

/** Contracts on one client or one project, for their record pages (PRD #18 §10, §11). */
export function listContractsFor(
  context: UserContext,
  link: { clientId?: string; projectId?: string },
) {
  return prisma.contract.findMany({
    where: {
      AND: [
        buildContractScopeWhere(context),
        { archivedAt: null },
        link.clientId ? { clientId: link.clientId } : {},
        link.projectId ? { projectId: link.projectId } : {},
      ],
    },
    orderBy: [{ status: "asc" }, { expiryDate: { sort: "asc", nulls: "last" } }],
    select: SUMMARY_SELECT,
  });
}

/** Contracts sourced from one sales record, for the Sales handoff (PRD #18 §213, §506). */
export function listContractsForSalesSource(
  context: UserContext,
  source: { opportunityId?: string; proposalId?: string },
) {
  return prisma.contract.findMany({
    where: {
      AND: [
        buildContractScopeWhere(context),
        source.opportunityId ? { opportunityId: source.opportunityId } : {},
        source.proposalId ? { proposalId: source.proposalId } : {},
      ],
    },
    orderBy: [{ createdAt: "desc" }],
    select: SUMMARY_SELECT,
  });
}

export function countDocuments(contractId: string) {
  return prisma.document.count({
    where: { entityType: "contract", entityId: contractId, archivedAt: null },
  });
}

/* -------------------------------------------------------------------------- */
/* Filter options                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The values the filter dropdowns may offer (PRD #18 §297).
 *
 * Each list is resolved from contracts the caller can already see, so a filter
 * cannot name a client, a project or a colleague they could not otherwise
 * discover (PRD #18 §444).
 */
export async function contractFilterOptions(context: UserContext) {
  const scope = buildContractScopeWhere(context);

  const [clients, projects, owners, currencies] = await Promise.all([
    prisma.client.findMany({
      where: { AND: [buildContractClientWhere(context), { contracts: { some: scope } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { AND: [buildContractProjectWhere(context), { contracts: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, ownedContracts: { some: scope } },
      select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
    prisma.contract.findMany({
      where: { AND: [scope, { currency: { not: null } }] },
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return {
    clients,
    projects,
    owners,
    currencies: currencies.map((row) => row.currency!).filter(Boolean),
  };
}

/**
 * What a contract form may name (PRD #18 §95–§97, §297).
 *
 * Deliberately not `contractFilterOptions`: that one lists the clients and
 * projects that already *have* contracts, which is the right set to filter by
 * and the wrong set to create with.
 *
 * Every list is resolved through the caller's own access to the other module.
 * A picker must not become a directory of records they cannot open, so a reader
 * without Sales access is offered no sales source at all rather than a dropdown
 * of every deal in the company (PRD #18 §252, §297).
 */
export async function contractFormOptions(context: UserContext) {
  const maySeeOpportunities =
    can(context, "sales.view") && can(context, "sales.opportunity.view");
  const maySeeProposals = can(context, "sales.view") && can(context, "sales.proposal.view");

  const [owners, clients, projects, opportunities, proposals] = await Promise.all([
    prisma.companyMember.findMany({
      where: buildContractOwnerWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
    prisma.client.findMany({
      where: buildContractClientWhere(context),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: buildContractProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    // WON / ACCEPTED are what a contract is normally drawn from (PRD #18 §57,
    // §58). The service still accepts any in-company record, so an unusual
    // lineage recorded through the API is not refused — it simply is not
    // offered in the dropdown.
    maySeeOpportunities
      ? prisma.opportunity.findMany({
          where: {
            AND: [buildOpportunityScopeWhere(context), { stage: "WON", archivedAt: null }],
          },
          select: { id: true, name: true },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
    maySeeProposals
      ? prisma.proposal.findMany({
          where: {
            AND: [buildProposalScopeWhere(context), { status: "ACCEPTED", archivedAt: null }],
          },
          select: { id: true, proposalNumber: true, title: true },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  return { owners, clients, projects, opportunities, proposals };
}

/** Every contract in scope, projected for a report or an overview aggregate. */
export function contractFacts(context: UserContext, where: Prisma.ContractWhereInput = {}) {
  return prisma.contract.findMany({
    where: { AND: [buildContractScopeWhere(context), where] },
    select: {
      id: true,
      status: true,
      contractType: true,
      currency: true,
      contractValue: true,
      effectiveDate: true,
      expiryDate: true,
      renewalType: true,
      renewalNoticeDays: true,
      ownerMemberId: true,
      clientId: true,
      projectId: true,
    },
  });
}

/**
 * Contracts that need somebody's attention, found in the database (PRD #18 §339).
 *
 * The attention lists used to be derived by filtering a page of results in
 * memory. For "expiring soonest" that happened to work, because the page was
 * sorted by expiry. For "the owner has left" it did not: an inactive owner on a
 * contract expiring in two years sorts nowhere near the top, so it was
 * invisible no matter how much it needed attention — and an attention surface
 * that silently under-reports is worse than none, because people stop checking
 * by hand.
 */
export function contractsWithInactiveOwner(context: UserContext, take: number) {
  return prisma.contract.findMany({
    where: {
      AND: [
        buildContractScopeWhere(context),
        { archivedAt: null, status: "ACTIVE", owner: { status: { not: "ACTIVE" } } },
      ],
    },
    orderBy: [{ expiryDate: "asc" }, { contractNumber: "asc" }],
    take,
    select: SUMMARY_SELECT,
  });
}

/**
 * Candidates for a renewal notice falling due.
 *
 * The exact rule compares `expiryDate - renewalNoticeDays` against today, which
 * is arithmetic between two columns and not expressible in a Prisma filter. So
 * the database narrows to active contracts expiring within a year — any notice
 * period longer than that is not a notice period — and the caller applies the
 * precise test. The candidate set is bounded by the calendar rather than by a
 * page, which is the part that was wrong.
 */
export function renewalNoticeCandidates(context: UserContext, today: Date) {
  const horizon = new Date(today.getTime() + 366 * 24 * 60 * 60 * 1000);

  return prisma.contract.findMany({
    where: {
      AND: [
        buildContractScopeWhere(context),
        {
          archivedAt: null,
          status: "ACTIVE",
          renewalNoticeDays: { not: null },
          expiryDate: { gte: today, lte: horizon },
        },
      ],
    },
    orderBy: [{ expiryDate: "asc" }],
    select: SUMMARY_SELECT,
  });
}
