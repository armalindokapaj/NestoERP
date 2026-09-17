import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { clampAtZero, subtract, toAmountString, ZERO, type Money } from "../finance.money";
import {
  buildCommitmentScopeWhere,
  buildExpenseScopeWhere,
  buildInvoiceScopeWhere,
  buildPaymentScopeWhere,
} from "../finance.scope";
import { baseCurrency } from "../finance.settings";
import { paidByInvoice } from "../finance.settlement";
import { projectFinanceNumbers } from "../budgets/budget.summary";
import type { CurrencyTotal } from "../finance.types";
import type { BudgetRisk } from "../budgets/budget.status";

/**
 * Built-in finance reports (PRD #15 §147–§156).
 *
 * Every report runs through the same scope clauses the lists do, so a report is
 * never a way to read records the reader cannot open (PRD #15 §158, §270).
 * There is no report-only query, and no "export everything" path.
 */

const MODULE = "finance" as const;

/* -------------------------------------------------------------------------- */
/* Receivables aging (PRD #15 §149, §150)                                      */
/* -------------------------------------------------------------------------- */

export const AGING_BUCKETS = ["CURRENT", "D1_30", "D31_60", "D61_90", "D90_PLUS"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const agingBucketLabels: Record<AgingBucket, string> = {
  CURRENT: "Current",
  D1_30: "1–30 days",
  D31_60: "31–60 days",
  D61_90: "61–90 days",
  D90_PLUS: "90+ days",
};

export type AgingRow = {
  currency: string;
  buckets: Record<AgingBucket, string>;
  total: string;
};

/**
 * Aging is computed from `dueDate` against today, never stored (PRD #15 §255).
 *
 * Persisting a bucket would mean an invoice that quietly aged overnight showed
 * yesterday's answer until something rewrote it.
 */
export async function receivablesAging(
  context: UserContext,
  options: { now?: Date } = {},
): Promise<AgingRow[]> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.report.view");
  assertPermission(context, "finance.receivables.view");

  const now = options.now ?? new Date();

  const invoices = await prisma.invoice.findMany({
    where: { AND: [buildInvoiceScopeWhere(context), { status: "SENT" }] },
    select: { id: true, currency: true, totalAmount: true, dueDate: true },
  });

  if (invoices.length === 0) return [];

  const paidById = await paidByInvoice(invoices.map((row) => row.id));

  const byCurrency = new Map<string, Record<AgingBucket, Money>>();

  for (const invoice of invoices) {
    const outstanding = clampAtZero(
      subtract(invoice.totalAmount, paidById.get(invoice.id) ?? ZERO),
    );
    if (outstanding.isZero()) continue;

    const bucket = agingBucketFor(invoice.dueDate, now);
    const row =
      byCurrency.get(invoice.currency) ??
      ({ CURRENT: ZERO, D1_30: ZERO, D31_60: ZERO, D61_90: ZERO, D90_PLUS: ZERO } as Record<
        AgingBucket,
        Money
      >);

    row[bucket] = row[bucket].plus(outstanding);
    byCurrency.set(invoice.currency, row);
  }

  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, buckets]) => ({
      currency,
      buckets: Object.fromEntries(
        AGING_BUCKETS.map((bucket) => [bucket, toAmountString(buckets[bucket])]),
      ) as Record<AgingBucket, string>,
      total: toAmountString(
        AGING_BUCKETS.reduce<Money>((sum, bucket) => sum.plus(buckets[bucket]), ZERO),
      ),
    }));
}

export function agingBucketFor(dueDate: Date, now: Date): AgingBucket {
  const days = Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000);
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "D1_30";
  if (days <= 60) return "D31_60";
  if (days <= 90) return "D61_90";
  return "D90_PLUS";
}

/* -------------------------------------------------------------------------- */
/* Budget vs actual (PRD #15 §151)                                             */
/* -------------------------------------------------------------------------- */

export type BudgetVsActualRow = {
  projectId: string;
  code: string;
  name: string;
  currency: string;
  budget: string;
  actual: string;
  openCommitments: string;
  forecast: string;
  variance: string;
  utilizationPercent: string | null;
  risk: BudgetRisk | null;
};

export async function budgetVsActual(context: UserContext): Promise<BudgetVsActualRow[]> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.report.view");
  assertPermission(context, "finance.project_budget.view");

  // Only projects with an approved budget appear: a project with nothing to
  // compare against has no variance to report (PRD #15 §151).
  const budgets = await prisma.projectBudget.findMany({
    where: {
      AND: [
        { companyId: context.companyId, isCurrent: true, status: "APPROVED" },
        { project: projectFilterFor(context) },
      ],
    },
    select: {
      projectId: true,
      project: { select: { code: true, name: true } },
    },
  });

  if (budgets.length === 0) return [];

  const fallback = await baseCurrency(context.companyId);
  const numbers = await projectFinanceNumbers(
    budgets.map((row) => row.projectId),
    fallback,
  );

  return budgets
    .map((row) => {
      const figures = numbers.get(row.projectId)!;
      return {
        projectId: row.projectId,
        code: row.project.code,
        name: row.project.name,
        currency: figures.currency,
        budget: toAmountString(figures.budgetAmount),
        actual: toAmountString(figures.actualCost),
        openCommitments: toAmountString(figures.openCommitments),
        forecast: toAmountString(figures.forecastCost),
        variance: toAmountString(figures.variance),
        utilizationPercent: figures.utilizationPercent,
        risk: figures.risk,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/* Expenses by category (PRD #15 §153)                                         */
/* -------------------------------------------------------------------------- */

export type CategoryRow = {
  category: string;
  currency: string;
  actual: string;
  committed: string;
};

export async function expensesByCategory(
  context: UserContext,
  options: { projectId?: string; from?: Date; to?: Date } = {},
): Promise<CategoryRow[]> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.report.view");
  assertPermission(context, "finance.expense.view");

  const dateFilter: Prisma.ExpenseWhereInput = {
    ...(options.from ? { expenseDate: { gte: options.from } } : {}),
    ...(options.to ? { expenseDate: { lte: options.to } } : {}),
  };

  const [expenses, commitments] = await Promise.all([
    prisma.expense.groupBy({
      by: ["category", "currency"],
      where: {
        AND: [
          buildExpenseScopeWhere(context),
          { status: "APPROVED" },
          options.projectId ? { projectId: options.projectId } : {},
          dateFilter,
        ],
      },
      _sum: { totalAmount: true },
    }),
    can(context, "finance.commitment.view")
      ? prisma.commitment.groupBy({
          by: ["category", "currency"],
          where: {
            AND: [
              buildCommitmentScopeWhere(context),
              { status: "APPROVED" },
              options.projectId ? { projectId: options.projectId } : {},
            ],
          },
          _sum: { amount: true },
        })
      : Promise.resolve([]),
  ]);

  const keys = new Set([
    ...expenses.map((row) => `${row.category}|${row.currency}`),
    ...commitments.map((row) => `${row.category}|${row.currency}`),
  ]);

  return [...keys]
    .map((key) => {
      const [category, currency] = key.split("|");
      const actual =
        expenses.find((row) => row.category === category && row.currency === currency)?._sum
          .totalAmount ?? ZERO;
      const committed =
        commitments.find((row) => row.category === category && row.currency === currency)?._sum
          .amount ?? ZERO;

      return {
        category,
        currency,
        actual: toAmountString(actual),
        committed: toAmountString(committed),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.currency.localeCompare(b.currency));
}

/* -------------------------------------------------------------------------- */
/* Cashflow (PRD #15 §154, §155)                                               */
/* -------------------------------------------------------------------------- */

export const CASHFLOW_PERIODS = ["this-month", "last-month", "quarter", "ytd"] as const;
export type CashflowPeriod = (typeof CASHFLOW_PERIODS)[number];

export const cashflowPeriodLabels: Record<CashflowPeriod, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  quarter: "This quarter",
  ytd: "Year to date",
};

export type CashflowReport = {
  period: CashflowPeriod;
  from: string;
  to: string;
  rows: { currency: string; cashIn: string; cashOut: string; net: string }[];
};

export async function cashflowSummary(
  context: UserContext,
  period: CashflowPeriod = "this-month",
  options: { now?: Date } = {},
): Promise<CashflowReport> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.report.view");
  assertPermission(context, "finance.cashflow.view");

  const now = options.now ?? new Date();
  const range = periodRange(period, now);
  const scope = buildPaymentScopeWhere(context);

  const rows = await prisma.payment.groupBy({
    by: ["currency", "direction"],
    where: {
      AND: [
        scope,
        { status: "RECORDED", paymentDate: { gte: range.from, lte: range.to } },
      ],
    },
    _sum: { amount: true },
  });

  const currencies = [...new Set(rows.map((row) => row.currency))].sort();

  return {
    period,
    from: range.from.toISOString().slice(0, 10),
    to: range.to.toISOString().slice(0, 10),
    rows: currencies.map((currency) => {
      const cashIn =
        rows.find((row) => row.currency === currency && row.direction === "RECEIPT")?._sum
          .amount ?? ZERO;
      const cashOut =
        rows.find((row) => row.currency === currency && row.direction === "DISBURSEMENT")?._sum
          .amount ?? ZERO;

      return {
        currency,
        cashIn: toAmountString(cashIn),
        cashOut: toAmountString(cashOut),
        net: toAmountString(subtract(cashIn, cashOut)),
      };
    }),
  };
}

export function periodRange(period: CashflowPeriod, now: Date): { from: Date; to: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  switch (period) {
    case "last-month":
      return {
        from: new Date(Date.UTC(year, month - 1, 1)),
        to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
      };
    case "quarter": {
      const quarterStart = Math.floor(month / 3) * 3;
      return {
        from: new Date(Date.UTC(year, quarterStart, 1)),
        to: new Date(Date.UTC(year, quarterStart + 3, 0, 23, 59, 59, 999)),
      };
    }
    case "ytd":
      return {
        from: new Date(Date.UTC(year, 0, 1)),
        to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
      };
    case "this-month":
    default:
      return {
        from: new Date(Date.UTC(year, month, 1)),
        to: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Commitment summary (PRD #15 §156)                                           */
/* -------------------------------------------------------------------------- */

export type CommitmentSummaryRow = {
  projectId: string | null;
  projectName: string;
  currency: string;
  category: string;
  amount: string;
};

export async function commitmentSummary(
  context: UserContext,
): Promise<{ rows: CommitmentSummaryRow[]; totals: CurrencyTotal[] }> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.report.view");
  assertPermission(context, "finance.commitment.view");

  const rows = await prisma.commitment.groupBy({
    by: ["projectId", "currency", "category"],
    where: { AND: [buildCommitmentScopeWhere(context), { status: "APPROVED" }] },
    _sum: { amount: true },
  });

  const projectIds = rows
    .map((row) => row.projectId)
    .filter((id): id is string => id !== null);

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(projects.map((project) => [project.id, project.name]));

  const byCurrency = new Map<string, Money>();
  for (const row of rows) {
    const current = byCurrency.get(row.currency) ?? ZERO;
    byCurrency.set(row.currency, current.plus(row._sum.amount ?? ZERO));
  }

  return {
    rows: rows
      .map((row) => ({
        projectId: row.projectId,
        projectName: row.projectId
          ? (nameById.get(row.projectId) ?? "Unknown project")
          : "Company-wide",
        currency: row.currency,
        category: row.category,
        amount: toAmountString(row._sum.amount ?? ZERO),
      }))
      .sort(
        (a, b) =>
          a.projectName.localeCompare(b.projectName) || a.category.localeCompare(b.category),
      ),
    totals: [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: toAmountString(amount) })),
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The project filter a budget report must apply.
 *
 * Reuses the budget scope clause's own project gate rather than restating it,
 * so a report can never widen what a list would show (PRD #15 §209).
 */
function projectFilterFor(context: UserContext): Prisma.ProjectWhereInput {
  const scope = buildExpenseScopeWhere(context);
  const project = (scope as { project?: Prisma.ProjectWhereInput }).project;
  return project ?? { companyId: context.companyId };
}
