import { Prisma } from "@prisma/client";

import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import * as approvals from "../approvals/approval.service";
import { buildLeadUnionWhere, buildOpportunityUnionWhere, buildProposalUnionWhere } from "../sales.scope";
import type { CompanyRef, SalesAttentionDTO, SalesOverviewDTO } from "../sales.types";
import { companyRefs, groupReaders } from "../sales.workspace";
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

/**
 * Who reads each panel. In a company it is the session's own context, or
 * nothing when it lacks the grant; in the Group workspace it is every
 * authorised company whose own grant lets them — so a company where the reader
 * cannot see leads is not counted in the lead figures, rather than counted
 * partly (Workspace Context §60, §92).
 */
type PanelReaders = {
  opportunities: UserContext[];
  leads: UserContext[];
  proposals: UserContext[];
  approvers: UserContext[];
};

function panelReaders(contexts: UserContext[]): PanelReaders {
  return {
    opportunities: contexts.filter((context) => can(context, "sales.opportunity.view")),
    leads: contexts.filter((context) => can(context, "sales.lead.view")),
    proposals: contexts.filter((context) => can(context, "sales.proposal.view")),
    approvers: contexts.filter((context) => can(context, "sales.proposal.approve") || can(context, "sales.proposal.reject")),
  };
}

export async function getSalesOverview(context: UserContext): Promise<SalesOverviewDTO> {
  assertModule(context, "sales");
  assertPermission(context, "sales.view");

  return overviewFor(panelReaders([context]));
}

/**
 * The overview for the active workspace (Workspace Context §37, §72): the
 * company's own, or in the Group workspace the same figures over the union of
 * every authorised company's scope. Money stays per currency — the group's open
 * pipeline is "€X · $Y", never one number — and the win rate is won over
 * decided across all of them, recomputed from counts rather than averaged.
 */
export async function getSalesOverviewForWorkspace(session: UserContext, companyId?: string): Promise<SalesOverviewDTO> {
  if (!inGroupWorkspace(session)) return getSalesOverview(session);
  return overviewFor(panelReaders(await groupReaders(session, "sales.view", companyId)));
}

async function overviewFor(readers: PanelReaders): Promise<SalesOverviewDTO> {
  const visible = {
    leads: readers.leads.length > 0,
    opportunities: readers.opportunities.length > 0,
    proposals: readers.proposals.length > 0,
    approvals: readers.approvers.length > 0,
  };

  const { monthStart, monthEnd } = currentMonth();
  const opportunityScope = buildOpportunityUnionWhere(readers.opportunities);

  const [openRows, closedRows, closeThisMonth, leadCounts, pendingApprovals] = await Promise.all([
    visible.opportunities
      ? opportunityRepository.openOpportunityAggregateRowsIn(opportunityScope)
      : Promise.resolve([]),
    visible.opportunities
      ? opportunityRepository.closedOpportunityRowsIn(opportunityScope, monthStart, monthEnd)
      : Promise.resolve([]),
    visible.opportunities
      ? prisma.opportunity.findMany({
          where: {
            AND: [
              opportunityScope,
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
    visible.leads ? leadCountsFor(readers.leads, monthStart, monthEnd) : Promise.resolve(null),
    visible.proposals
      ? Promise.all(readers.proposals.map((context) => approvals.pendingApprovalCount(context))).then((counts) =>
          counts.reduce((sum, count) => sum + count, 0),
        )
      : Promise.resolve(0),
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

  return attentionFor(panelReaders([context]));
}

/**
 * The attention lists for the active workspace: the company's own, or in the
 * Group workspace the same five lists over every authorised company, each row
 * naming its company. The five are each the top of the union, not the top of
 * each company merged after the fact.
 */
export async function attentionListForWorkspace(session: UserContext, companyId?: string): Promise<SalesAttentionDTO> {
  if (!inGroupWorkspace(session)) return attentionList(session);

  const readers = panelReaders(await groupReaders(session, "sales.view", companyId));
  const names = companyRefs([...readers.opportunities, ...readers.leads, ...readers.proposals]);
  return attentionFor(readers, names);
}

async function attentionFor(readers: PanelReaders, companies?: Map<string, CompanyRef>): Promise<SalesAttentionDTO> {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000);

  const seesOpportunities = readers.opportunities.length > 0;
  const seesLeads = readers.leads.length > 0;
  const seesProposals = readers.proposals.length > 0;

  const openScope: Prisma.OpportunityWhereInput = {
    AND: [buildOpportunityUnionWhere(readers.opportunities), { archivedAt: null, stage: { in: OPEN_STAGES } }],
  };
  // Every row says which company it is; only a group read shows it (§45).
  const opportunitySelect = opportunityRepository.GROUP_SUMMARY_SELECT;

  const [overdueClose, noNextStep, inactiveOwners, qualifiedLeads, expiringProposals] =
    await Promise.all([
      seesOpportunities
        ? prisma.opportunity.findMany({
            where: { AND: [openScope, { expectedCloseDate: { lt: now } }] },
            orderBy: [{ expectedCloseDate: "asc" }, { id: "asc" }],
            take: 5,
            select: opportunitySelect,
          })
        : Promise.resolve([]),
      seesOpportunities
        ? prisma.opportunity.findMany({
            where: { AND: [openScope, { OR: [{ nextStep: null }, { nextStep: "" }] }] },
            orderBy: [{ estimatedValue: "desc" }, { id: "asc" }],
            take: 5,
            select: opportunitySelect,
          })
        : Promise.resolve([]),
      // An open deal owned by somebody who has left needs reassigning, not
      // quietly leaving in a list (PRD #17 §428, §433).
      seesOpportunities
        ? prisma.opportunity.findMany({
            where: { AND: [openScope, { owner: { status: { not: "ACTIVE" } } }] },
            orderBy: [{ estimatedValue: "desc" }, { id: "asc" }],
            take: 5,
            select: opportunitySelect,
          })
        : Promise.resolve([]),
      seesLeads
        ? prisma.lead.findMany({
            where: { AND: [buildLeadUnionWhere(readers.leads), { status: "QUALIFIED" }] },
            orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
            take: 5,
            select: {
              id: true,
              companyId: true,
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
                buildProposalUnionWhere(readers.proposals),
                { status: "SENT", validUntil: { not: null, lte: soon } },
              ],
            },
            orderBy: [{ validUntil: "asc" }, { id: "asc" }],
            take: 5,
            select: {
              id: true,
              companyId: true,
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

  const stamp = <T extends object>(dto: T, companyId: string): T =>
    companies ? ({ ...dto, company: companies.get(companyId) } as T) : dto;

  return {
    overdueClose: overdueClose.map((row) => stamp(opportunitySummary(row), row.companyId)),
    noNextStep: noNextStep.map((row) => stamp(opportunitySummary(row), row.companyId)),
    inactiveOwners: inactiveOwners.map((row) => stamp(opportunitySummary(row), row.companyId)),
    qualifiedLeads: qualifiedLeads.map((row) => stamp(leadSummary(row), row.companyId)),
    expiringProposals: expiringProposals.map((row) => stamp(proposalSummary(row), row.companyId)),
  };
}

async function leadCountsFor(readers: UserContext[], from: Date, to: Date) {
  const scope = buildLeadUnionWhere(readers);

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
