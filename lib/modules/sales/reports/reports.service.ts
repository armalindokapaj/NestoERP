import { Prisma, type OpportunityStage, type ProposalStatus } from "@prisma/client";

import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { buildLeadScopeWhere, buildOpportunityScopeWhere } from "../sales.scope";
import type {
  CurrencyTotal,
  ForecastBucket,
  LeadConversionRow,
  LostReasonRow,
  OwnerPerformanceRow,
  ProposalReportRow,
} from "../sales.types";
import { toMemberRef } from "../sales.dto";
import {
  acceptanceRate,
  currencyTotals,
  forecastBuckets,
  winRate,
} from "../opportunities/opportunity.forecast";
import { OPEN_STAGES, OPPORTUNITY_STAGES } from "../opportunities/opportunity.stage";
import * as opportunityRepository from "../opportunities/opportunity.repository";
import * as proposalRepository from "../proposals/proposal.repository";

/**
 * Sales reports (PRD #17 §161–§172).
 *
 * Every report runs through the same scope clause as the list it summarises, so
 * an assigned rep's report is their own numbers (PRD #17 §339). And every
 * monetary figure is grouped by currency: there is no FX engine in V0.1, so a
 * single "total pipeline" across currencies would be a number the company
 * cannot reconcile (PRD #17 §172).
 */

export type SalesReportKey =
  | "pipeline"
  | "forecast"
  | "win-loss"
  | "by-owner"
  | "lead-conversion"
  | "expected-close"
  | "lost-reasons"
  | "proposals";

export const SALES_REPORTS: { key: SalesReportKey; label: string; description: string }[] = [
  { key: "pipeline", label: "Pipeline by stage", description: "Open value and weighted value per stage." },
  { key: "forecast", label: "Weighted forecast", description: "Expected value by close month." },
  { key: "win-loss", label: "Win / loss", description: "Decided deals in the period, and the win rate." },
  { key: "by-owner", label: "Sales by owner", description: "Pipeline and outcomes per person." },
  { key: "lead-conversion", label: "Lead conversion", description: "How many leads became opportunities." },
  { key: "expected-close", label: "Expected close", description: "Open deals by when they are due." },
  { key: "lost-reasons", label: "Lost reasons", description: "Why deals did not close." },
  { key: "proposals", label: "Proposals", description: "Proposal position and acceptance rate." },
];

/** The period a report covers. Defaults to the current calendar year (§434). */
export type ReportPeriod = { from: Date; to: Date };

export function defaultPeriod(now = new Date()): ReportPeriod {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999)),
  };
}

function assertReportAccess(context: UserContext): void {
  assertModule(context, "sales");
  assertPermission(context, "sales.report.view");
}

/* -------------------------------------------------------------------------- */
/* Pipeline and forecast                                                       */
/* -------------------------------------------------------------------------- */

export type StageReportRow = { stage: OpportunityStage; totals: CurrencyTotal[] };

/** PRD #17 §162. */
export async function pipelineByStage(context: UserContext): Promise<StageReportRow[]> {
  assertReportAccess(context);
  assertPermission(context, "sales.opportunity.view");

  const rows = await opportunityRepository.openOpportunityAggregateRows(context);

  return OPEN_STAGES.map((stage) => ({
    stage,
    totals: currencyTotals(rows.filter((row) => row.stage === stage)),
  })).filter((row) => row.totals.length > 0);
}

/** PRD #17 §163, §167, §241. */
export async function expectedCloseReport(context: UserContext): Promise<ForecastBucket[]> {
  assertReportAccess(context);
  assertPermission(context, "sales.opportunity.view");

  const rows = await prisma.opportunity.findMany({
    where: {
      AND: [buildOpportunityScopeWhere(context), { archivedAt: null, stage: { in: OPEN_STAGES } }],
    },
    select: {
      stage: true,
      currency: true,
      estimatedValue: true,
      probabilityOverride: true,
      expectedCloseDate: true,
    },
  });

  return forecastBuckets(rows);
}

/* -------------------------------------------------------------------------- */
/* Outcomes                                                                    */
/* -------------------------------------------------------------------------- */

export type WinLossReport = {
  won: CurrencyTotal[];
  lost: CurrencyTotal[];
  wonCount: number;
  lostCount: number;
  winRate: string | null;
};

/** PRD #17 §164, §242, §436: the date basis is the close, not the creation. */
export async function winLossReport(
  context: UserContext,
  period: ReportPeriod,
): Promise<WinLossReport> {
  assertReportAccess(context);
  assertPermission(context, "sales.opportunity.view");

  const rows = await opportunityRepository.closedOpportunityRows(context, period.from, period.to);
  const won = rows.filter((row) => row.stage === "WON");
  const lost = rows.filter((row) => row.stage === "LOST");

  return {
    won: currencyTotals(won),
    lost: currencyTotals(lost),
    wonCount: won.length,
    lostCount: lost.length,
    winRate: winRate(won.length, lost.length),
  };
}

/** PRD #17 §168. */
export async function lostReasonReport(
  context: UserContext,
  period: ReportPeriod,
): Promise<LostReasonRow[]> {
  assertReportAccess(context);
  assertPermission(context, "sales.opportunity.view");

  const rows = await opportunityRepository.closedOpportunityRows(context, period.from, period.to);

  const buckets = new Map<string, LostReasonRow>();

  for (const row of rows) {
    if (row.stage !== "LOST" || !row.lostReason) continue;
    const key = `${row.lostReason}|${row.currency}`;
    const bucket = buckets.get(key) ?? {
      reason: row.lostReason,
      currency: row.currency,
      count: 0,
      value: "0.00",
    };
    bucket.count += 1;
    bucket.value = toAmountString(new Prisma.Decimal(bucket.value).plus(row.estimatedValue));
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

/** PRD #17 §166. */
export async function ownerReport(
  context: UserContext,
  period: ReportPeriod,
): Promise<OwnerPerformanceRow[]> {
  assertReportAccess(context);
  assertPermission(context, "sales.opportunity.view");

  const [openRows, closedRows] = await Promise.all([
    prisma.opportunity.findMany({
      where: {
        AND: [buildOpportunityScopeWhere(context), { archivedAt: null, stage: { in: OPEN_STAGES } }],
      },
      select: {
        stage: true,
        currency: true,
        estimatedValue: true,
        probabilityOverride: true,
        ownerMemberId: true,
        owner: {
          select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
    opportunityRepository.closedOpportunityRows(context, period.from, period.to),
  ]);

  type Bucket = OwnerPerformanceRow & { wonRaw: number; lostRaw: number };
  const buckets = new Map<string, Bucket>();

  function bucketFor(
    ownerMemberId: string,
    owner: { id: string; status: string; user: { firstName: string; lastName: string } },
    currency: string,
  ): Bucket {
    const key = `${ownerMemberId}|${currency}`;
    const existing = buckets.get(key);
    if (existing) return existing;

    const created: Bucket = {
      owner: toMemberRef(owner as Parameters<typeof toMemberRef>[0])!,
      currency,
      openCount: 0,
      openValue: "0.00",
      weightedValue: "0.00",
      wonCount: 0,
      wonValue: "0.00",
      lostCount: 0,
      lostValue: "0.00",
      winRate: null,
      wonRaw: 0,
      lostRaw: 0,
    };
    buckets.set(key, created);
    return created;
  }

  for (const row of openRows) {
    const bucket = bucketFor(row.ownerMemberId, row.owner, row.currency);
    const [totals] = currencyTotals([row]);
    bucket.openCount += 1;
    bucket.openValue = toAmountString(new Prisma.Decimal(bucket.openValue).plus(totals.value));
    bucket.weightedValue = toAmountString(
      new Prisma.Decimal(bucket.weightedValue).plus(totals.weightedValue),
    );
  }

  for (const row of closedRows) {
    const bucket = bucketFor(row.ownerMemberId, row.owner, row.currency);
    if (row.stage === "WON") {
      bucket.wonCount += 1;
      bucket.wonRaw += 1;
      bucket.wonValue = toAmountString(new Prisma.Decimal(bucket.wonValue).plus(row.estimatedValue));
    } else {
      bucket.lostCount += 1;
      bucket.lostRaw += 1;
      bucket.lostValue = toAmountString(
        new Prisma.Decimal(bucket.lostValue).plus(row.estimatedValue),
      );
    }
  }

  return [...buckets.values()]
    .map(({ wonRaw, lostRaw, ...row }) => ({ ...row, winRate: winRate(wonRaw, lostRaw) }))
    .sort((a, b) => Number.parseFloat(b.openValue) - Number.parseFloat(a.openValue));
}

/* -------------------------------------------------------------------------- */
/* Leads and proposals                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Lead conversion (PRD #17 §165, §243).
 *
 * The metric is deliberately the simple one — converted leads over leads
 * created in the period — and the UI says so, because a conversion rate whose
 * denominator is unexplained is a number two people will read two ways
 * (PRD #17 §165).
 */
export async function leadConversionReport(
  context: UserContext,
  period: ReportPeriod,
): Promise<LeadConversionRow> {
  assertReportAccess(context);
  assertPermission(context, "sales.lead.view");

  const scope = buildLeadScopeWhere(context);
  const window = { createdAt: { gte: period.from, lte: period.to } };

  const [totalCreated, converted, qualified, disqualified] = await Promise.all([
    prisma.lead.count({ where: { AND: [scope, window] } }),
    prisma.lead.count({ where: { AND: [scope, window, { status: "CONVERTED" }] } }),
    prisma.lead.count({ where: { AND: [scope, window, { status: "QUALIFIED" }] } }),
    prisma.lead.count({ where: { AND: [scope, window, { status: "DISQUALIFIED" }] } }),
  ]);

  return {
    totalCreated,
    converted,
    qualified,
    disqualified,
    conversionRate:
      totalCreated === 0
        ? null
        : new Prisma.Decimal(converted)
            .dividedBy(totalCreated)
            .times(100)
            .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
            .toFixed(1),
  };
}

const EMPTY_COUNTS = (): Record<ProposalStatus, number> => ({
  DRAFT: 0,
  PENDING_APPROVAL: 0,
  APPROVED: 0,
  REJECTED: 0,
  SENT: 0,
  ACCEPTED: 0,
  DECLINED: 0,
  CANCELLED: 0,
  ARCHIVED: 0,
});

/** PRD #17 §169, §244. */
export async function proposalReport(
  context: UserContext,
  period: ReportPeriod,
): Promise<ProposalReportRow[]> {
  assertReportAccess(context);
  assertPermission(context, "sales.proposal.view");

  const rows = await proposalRepository.proposalReportRows(context, period.from, period.to);
  const buckets = new Map<string, ProposalReportRow>();

  for (const row of rows) {
    const bucket = buckets.get(row.currency) ?? {
      currency: row.currency,
      counts: EMPTY_COUNTS(),
      acceptedValue: "0.00",
      sentValue: "0.00",
      acceptanceRate: null,
    };

    bucket.counts[row.status] += 1;
    if (row.status === "ACCEPTED") {
      bucket.acceptedValue = toAmountString(
        new Prisma.Decimal(bucket.acceptedValue).plus(row.totalAmount),
      );
    }
    if (row.status === "SENT") {
      bucket.sentValue = toAmountString(new Prisma.Decimal(bucket.sentValue).plus(row.totalAmount));
    }

    buckets.set(row.currency, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      acceptanceRate: acceptanceRate(bucket.counts.ACCEPTED, bucket.counts.DECLINED),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export { OPPORTUNITY_STAGES };
