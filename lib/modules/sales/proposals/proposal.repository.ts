import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { buildProposalScopeWhere } from "../sales.scope";
import type { ProposalListQuery, ProposalSortKey } from "./proposal.schema";

/** Proposal queries (PRD #17 §245, §248). */

const ORDER: Record<ProposalSortKey, Prisma.ProposalOrderByWithRelationInput[]> = {
  "updated-desc": [{ updatedAt: "desc" }],
  "number-asc": [{ proposalNumber: "asc" }],
  "number-desc": [{ proposalNumber: "desc" }],
  "amount-desc": [{ totalAmount: "desc" }],
  "amount-asc": [{ totalAmount: "asc" }],
  "valid-asc": [{ validUntil: { sort: "asc", nulls: "last" } }],
  "status-asc": [{ status: "asc" }, { updatedAt: "desc" }],
};

export const SUMMARY_SELECT = {
  id: true,
  proposalNumber: true,
  title: true,
  currency: true,
  totalAmount: true,
  validUntil: true,
  status: true,
  updatedAt: true,
  // The opportunity and client come back with the row, never per card
  // (PRD #17 §248).
  opportunity: { select: { id: true, name: true, stage: true } },
  client: { select: { id: true, name: true } },
} satisfies Prisma.ProposalSelect;

export type ProposalRow = Prisma.ProposalGetPayload<{ select: typeof SUMMARY_SELECT }>;

export const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  opportunityId: true,
  clientId: true,
  subtotal: true,
  taxAmount: true,
  notes: true,
  preArchiveStatus: true,
  sentAt: true,
  acceptedAt: true,
  declinedAt: true,
  archivedAt: true,
  createdAt: true,
  createdByMemberId: true,
  lineItems: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      taxRate: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.ProposalSelect;

export type ProposalDetailRow = Prisma.ProposalGetPayload<{ select: typeof DETAIL_SELECT }>;

export function buildProposalListWhere(
  context: UserContext,
  query: ProposalListQuery,
): Prisma.ProposalWhereInput {
  const filters: Prisma.ProposalWhereInput[] = [buildProposalScopeWhere(context)];

  filters.push(
    query.archived ? { status: "ARCHIVED" } : { archivedAt: null, status: { not: "ARCHIVED" } },
  );

  const search = searchClause(query.search, ["proposalNumber", "title", "notes"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.ProposalWhereInput),
        { client: { name: { contains: term, mode: "insensitive" } } },
        { opportunity: { name: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  if (query.status?.length && !query.archived) filters.push({ status: { in: query.status } });
  if (query.opportunityId) filters.push({ opportunityId: query.opportunityId });
  if (query.clientId) filters.push({ clientId: query.clientId });
  if (query.currency) filters.push({ currency: query.currency });

  return { AND: filters };
}

export async function listProposals(context: UserContext, query: ProposalListQuery) {
  const where = buildProposalListWhere(context, query);

  const [rows, total] = await Promise.all([
    prisma.proposal.findMany({
      where,
      orderBy: ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SUMMARY_SELECT,
    }),
    prisma.proposal.count({ where }),
  ]);

  return { rows, total };
}

export function findProposalInScope(context: UserContext, proposalId: string) {
  return prisma.proposal.findFirst({
    where: { AND: [buildProposalScopeWhere(context), { id: proposalId }] },
    select: DETAIL_SELECT,
  });
}

/** Proposals against one opportunity, for its detail page (PRD #17 §415). */
export function listProposalsForOpportunity(context: UserContext, opportunityId: string) {
  return prisma.proposal.findMany({
    where: { AND: [buildProposalScopeWhere(context), { opportunityId, archivedAt: null }] },
    orderBy: [{ proposalNumber: "asc" }],
    select: SUMMARY_SELECT,
  });
}

export async function proposalFilterOptions(context: UserContext) {
  const scope = buildProposalScopeWhere(context);

  const [clients, currencies] = await Promise.all([
    prisma.client.findMany({
      where: { companyId: context.companyId, proposals: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.proposal.findMany({
      where: scope,
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return { clients, currencies: currencies.map((row) => row.currency) };
}

/** Proposal totals in a period, for the proposal report (PRD #17 §169, §244). */
export function proposalReportRows(context: UserContext, from: Date, to: Date) {
  return proposalReportRowsIn(buildProposalScopeWhere(context), from, to);
}

/** The same rows for any scope: one company's, or the union a group reads. */
export function proposalReportRowsIn(scope: Prisma.ProposalWhereInput, from: Date, to: Date) {
  return prisma.proposal.findMany({
    where: {
      AND: [scope, { createdAt: { gte: from, lte: to } }],
    },
    select: { status: true, currency: true, totalAmount: true },
  });
}
