import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import * as approvals from "../approvals/approval.service";
import { buildLeadScopeWhere, buildOpportunityScopeWhere, buildProposalScopeWhere } from "../sales.scope";
import type { SalesAttentionDTO, SalesOverviewDTO } from "../sales.types";
import { currencyTotals, winRate } from "../opportunities/opportunity.forecast";
import { OPEN_STAGES } from "../opportunities/opportunity.stage";
import * as opportunityRepository from "../opportunities/opportunity.repository";
import { toSummaryDTO as opportunitySummary } from "../opportunities/opportunity.service";
import { toSummaryDTO as leadSummary } from "../leads/lead.service";
import { toSummaryDTO as proposalSummary } from "../proposals/proposal.service";

/**
 * The Sales overview (PRD #17 §21–§24, §239, §412, §413).
 *
 * Every figure is derived from the same scope clauses the lists use, so an
 * assigned rep's "open pipeline" is their pipeline and a company reader's is
 * the company's. A KPI computed from a wider query than the list beneath it is
 * a leak with a number on it (PRD #17 §412, §413).
 *
 * Panels are gated individually: somebody with commercial-value access alone
 * sees won value and nothing about leads, rather than a dashboard with holes
 * in it (PRD #17 §24).
 */

export async function getSalesOverview(context: UserContext): Promise<SalesOverviewDTO> {
  assertModule(context, "sales");
  assertPermission(context, "sales.view");

  const visible = {
    leads: can(context, "sales.lead.view"),
    opportunities: can(context, "sales.opportunity.view"),
    proposals: can(context, "sales.proposal.view"),
    approvals: can(context, "sales.proposal.approve") || can(context, "sales.proposal.reject"),
  };

  const { monthStart, monthEnd } = currentMonth();

  const [openRows, closedRows, closeThisMonth, leadCounts, pendingApprovals] = await Promise.all([
    visible.opportunities
      ? opportunityRepository.openOpportunityAggregateRows(context)
      : Promise.resolve([]),
    visible.opportunities
      ? opportunityRepository.closedOpportunityRows(context, monthStart, monthEnd)
      : Promise.resolve([]),
    visible.opportunities
      ? prisma.opportunity.findMany({
          where: {
            AND: [
              buildOpportunityScopeWhere(context),
              {
                archivedAt: null,
                stage: { in: OPEN_STAGES },
                expectedCloseDate: { gte: monthStart, lte: monthEnd },
              },
            ],
          },
          select: {
            stage: true,
            currency: true,
            estimatedValue: true,
            probabilityOverride: true,
          },
        })
      : Promise.resolve([]),
    visible.leads ? leadCountsFor(context, monthStart, monthEnd) : Promise.resolve(null),
    visible.proposals ? approvals.pendingApprovalCount(context) : Promise.resolve(0),
  ]);

  const won = closedRows.filter((row) => row.stage === "WON");
  const lost = closedRows.filter((row) => row.stage === "LOST");

  return {
    visible,
    openPipeline: currencyTotals(openRows),
    openOpportunities: openRows.length,
    newLeadsThisMonth: leadCounts?.created ?? 0,
    qualifiedLeads: leadCounts?.qualified ?? 0,
    expectedCloseThisMonth: currencyTotals(closeThisMonth),
    wonThisMonth: currencyTotals(won),
    lostThisMonth: currencyTotals(lost),
    pendingProposalApprovals: pendingApprovals,
    winRate: winRate(won.length, lost.length),
  };
}

/**
 * What needs somebody's attention today (PRD #17 §401–§405).
 *
 * All five are derived at read time. Nothing here changes a record because a
 * date passed: an opportunity does not become a different deal overnight, it
 * becomes one worth a phone call (PRD #17 §372, §403).
 */
export async function attentionList(context: UserContext): Promise<SalesAttentionDTO> {
  assertModule(context, "sales");

  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000);

  const seesOpportunities = can(context, "sales.opportunity.view");
  const seesLeads = can(context, "sales.lead.view");
  const seesProposals = can(context, "sales.proposal.view");

  const openScope: Prisma.OpportunityWhereInput = {
    AND: [buildOpportunityScopeWhere(context), { archivedAt: null, stage: { in: OPEN_STAGES } }],
  };

  const [overdueClose, noNextStep, inactiveOwners, qualifiedLeads, expiringProposals] =
    await Promise.all([
      seesOpportunities
        ? prisma.opportunity.findMany({
            where: { AND: [openScope, { expectedCloseDate: { lt: now } }] },
            orderBy: { expectedCloseDate: "asc" },
            take: 5,
            select: opportunityRepository.SUMMARY_SELECT,
          })
        : Promise.resolve([]),
      seesOpportunities
        ? prisma.opportunity.findMany({
            where: { AND: [openScope, { OR: [{ nextStep: null }, { nextStep: "" }] }] },
            orderBy: { estimatedValue: "desc" },
            take: 5,
            select: opportunityRepository.SUMMARY_SELECT,
          })
        : Promise.resolve([]),
      // An open deal owned by somebody who has left needs reassigning, not
      // quietly leaving in a list (PRD #17 §428, §433).
      seesOpportunities
        ? prisma.opportunity.findMany({
            where: { AND: [openScope, { owner: { status: { not: "ACTIVE" } } }] },
            orderBy: { estimatedValue: "desc" },
            take: 5,
            select: opportunityRepository.SUMMARY_SELECT,
          })
        : Promise.resolve([]),
      seesLeads
        ? prisma.lead.findMany({
            where: { AND: [buildLeadScopeWhere(context), { status: "QUALIFIED" }] },
            orderBy: { updatedAt: "asc" },
            take: 5,
            select: {
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
              owner: {
                select: {
                  id: true,
                  status: true,
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      seesProposals
        ? prisma.proposal.findMany({
            where: {
              AND: [
                buildProposalScopeWhere(context),
                { status: "SENT", validUntil: { not: null, lte: soon } },
              ],
            },
            orderBy: { validUntil: "asc" },
            take: 5,
            select: {
              id: true,
              proposalNumber: true,
              title: true,
              currency: true,
              totalAmount: true,
              validUntil: true,
              status: true,
              updatedAt: true,
              opportunity: { select: { id: true, name: true, stage: true } },
              client: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

  return {
    overdueClose: overdueClose.map(opportunitySummary),
    noNextStep: noNextStep.map(opportunitySummary),
    inactiveOwners: inactiveOwners.map(opportunitySummary),
    qualifiedLeads: qualifiedLeads.map(leadSummary),
    expiringProposals: expiringProposals.map(proposalSummary),
  };
}

async function leadCountsFor(context: UserContext, from: Date, to: Date) {
  const scope = buildLeadScopeWhere(context);

  const [created, qualified] = await Promise.all([
    prisma.lead.count({
      where: { AND: [scope, { createdAt: { gte: from, lte: to }, status: { not: "ARCHIVED" } }] },
    }),
    prisma.lead.count({ where: { AND: [scope, { status: "QUALIFIED" }] } }),
  ]);

  return { created, qualified };
}

/** The current calendar month, in UTC, so every panel agrees on "this month". */
export function currentMonth(now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
  return { monthStart, monthEnd };
}
