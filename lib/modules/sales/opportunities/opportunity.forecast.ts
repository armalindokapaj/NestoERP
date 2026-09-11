import { Prisma, type OpportunityStage } from "@prisma/client";

import { toAmountString } from "@/lib/modules/finance/finance.money";
import type { CurrencyTotal, ForecastBucket } from "../sales.types";
import { effectiveProbability, weightedValue } from "./opportunity.stage";

/**
 * Pipeline arithmetic (PRD #17 §29, §31, §103, §172, §240, §241).
 *
 * One rule governs everything here: **values are grouped by currency and never
 * summed across them**. V0.1 has no FX engine, so "€400,000 + $200,000 =
 * 600,000" is not a number this product is allowed to print (PRD #17 §31).
 *
 * The weighted figure is computed per row before it is added up, because
 * `sum(value) × average(probability)` and `sum(value × probability)` are
 * different numbers, and only the second one is the forecast.
 */

export type ForecastRow = {
  stage: OpportunityStage;
  currency: string;
  estimatedValue: Prisma.Decimal;
  probabilityOverride: Prisma.Decimal | null;
};

type Accumulator = { count: number; value: Prisma.Decimal; weighted: Prisma.Decimal };

function emptyAccumulator(): Accumulator {
  return { count: 0, value: new Prisma.Decimal(0), weighted: new Prisma.Decimal(0) };
}

function accumulate(into: Map<string, Accumulator>, row: ForecastRow): void {
  const bucket = into.get(row.currency) ?? emptyAccumulator();
  const probability = effectiveProbability(row.stage, row.probabilityOverride);

  bucket.count += 1;
  bucket.value = bucket.value.plus(row.estimatedValue);
  bucket.weighted = bucket.weighted.plus(weightedValue(row.estimatedValue, probability));

  into.set(row.currency, bucket);
}

/** Totals for one set of rows, one entry per currency, largest first. */
export function currencyTotals(rows: ForecastRow[]): CurrencyTotal[] {
  const buckets = new Map<string, Accumulator>();
  for (const row of rows) accumulate(buckets, row);

  return [...buckets.entries()]
    .map(([currency, bucket]) => ({
      currency,
      count: bucket.count,
      value: toAmountString(bucket.value),
      weightedValue: toAmountString(bucket.weighted),
    }))
    .sort((a, b) => Number.parseFloat(b.value) - Number.parseFloat(a.value));
}

export function totalsByStage(rows: ForecastRow[]): Map<OpportunityStage, CurrencyTotal[]> {
  const byStage = new Map<OpportunityStage, ForecastRow[]>();
  for (const row of rows) {
    const list = byStage.get(row.stage) ?? [];
    list.push(row);
    byStage.set(row.stage, list);
  }

  const result = new Map<OpportunityStage, CurrencyTotal[]>();
  for (const [stage, stageRows] of byStage) result.set(stage, currencyTotals(stageRows));
  return result;
}

/* -------------------------------------------------------------------------- */
/* Date buckets                                                                */
/* -------------------------------------------------------------------------- */

export type DatedForecastRow = ForecastRow & { expectedCloseDate: Date | null };

export type ForecastBucketKey = "OVERDUE" | "THIS_MONTH" | "NEXT_MONTH" | "LATER" | "NO_DATE";

const BUCKET_LABELS: Record<ForecastBucketKey, string> = {
  OVERDUE: "Overdue",
  THIS_MONTH: "This month",
  NEXT_MONTH: "Next month",
  LATER: "Later",
  NO_DATE: "No close date",
};

const BUCKET_ORDER: ForecastBucketKey[] = [
  "OVERDUE",
  "THIS_MONTH",
  "NEXT_MONTH",
  "LATER",
  "NO_DATE",
];

/**
 * Which bucket an expected close date falls into (PRD #17 §167, §241).
 *
 * Server-side, so "this month" means the same thing to the forecast, the
 * report and the attention list — rather than whatever each caller's clock
 * happened to say.
 */
export function forecastBucketFor(date: Date | null, now = new Date()): ForecastBucketKey {
  if (!date) return "NO_DATE";

  const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const startOfMonthAfter = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));

  if (date.getTime() < startOfThisMonth.getTime()) return "OVERDUE";
  if (date.getTime() < startOfNextMonth.getTime()) return "THIS_MONTH";
  if (date.getTime() < startOfMonthAfter.getTime()) return "NEXT_MONTH";
  return "LATER";
}

export function forecastBuckets(rows: DatedForecastRow[], now = new Date()): ForecastBucket[] {
  const byBucket = new Map<ForecastBucketKey, ForecastRow[]>();

  for (const row of rows) {
    const key = forecastBucketFor(row.expectedCloseDate, now);
    const list = byBucket.get(key) ?? [];
    list.push(row);
    byBucket.set(key, list);
  }

  return BUCKET_ORDER.filter((key) => byBucket.has(key)).map((key) => ({
    key,
    label: BUCKET_LABELS[key],
    totals: currencyTotals(byBucket.get(key)!),
  }));
}

/**
 * Win rate over decided deals (PRD #17 §164, §242).
 *
 * Open opportunities are excluded: a deal nobody has closed is not a loss, and
 * counting it as one makes every growing pipeline look like a failing one. A
 * period with nothing closed answers `null` rather than `0%`, because "0% of
 * nothing" is not a fact about the sales team.
 */
export function winRate(won: number, lost: number): string | null {
  const decided = won + lost;
  if (decided === 0) return null;
  return new Prisma.Decimal(won)
    .dividedBy(decided)
    .times(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(1);
}

/** Acceptance over *decided* sent proposals (PRD #17 §244). */
export function acceptanceRate(accepted: number, declined: number): string | null {
  return winRate(accepted, declined);
}
