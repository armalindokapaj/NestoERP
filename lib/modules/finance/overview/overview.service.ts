import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { countPendingApprovals } from "../approvals/approval.service";
import { clampAtZero, subtract, toAmountString, ZERO, type Money } from "../finance.money";
import {
  buildCommitmentScopeWhere,
  buildExpenseScopeWhere,
  buildInvoiceScopeWhere,
  buildPaymentScopeWhere,
} from "../finance.scope";
import { baseCurrency } from "../finance.settings";
import type { CurrencyTotal, FinanceOverviewDTO } from "../finance.types";

/**
 * The Finance overview (PRD #15 §21–§27, §249–§256).
 *
 * Every figure is a database aggregate, grouped by currency. V0.1 has no FX
 * engine, so EUR and USD are reported side by side and never added: a single
 * "total receivables" number across currencies would be arithmetic that means
 * nothing (PRD #15 §36, §150).
 *
 * Each panel is gated by its own permission, so the overview a Sales user sees
 * is receivables alone rather than a company cash position with holes in it
 * (PRD #15 §25).
 */

const MODULE = "finance" as const;

export async function getFinanceOverview(
  context: UserContext,
  options: { now?: Date } = {},
): Promise<FinanceOverviewDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.dashboard.view");

  const now = options.now ?? new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const visible = {
    receivables: can(context, "finance.receivables.view") && can(context, "finance.invoice.view"),
    payables: can(context, "finance.payables.view") && can(context, "finance.expense.view"),
    cashflow: can(context, "finance.cashflow.view") && can(context, "finance.payment.view"),
    commitments: can(context, "finance.commitment.view"),
    approvals: can(context, "finance.approval.view"),
    projectBudgets: can(context, "finance.project_budget.view"),
  };

  const [receivables, payables, cash, commitments, counts, currency] = await Promise.all([
    visible.receivables ? receivableTotals(context, now) : emptyReceivables(),
    visible.payables ? payableTotals(context) : Promise.resolve([]),
    visible.cashflow ? cashTotals(context, monthStart) : Promise.resolve({ in: [], out: [] }),
    visible.commitments ? openCommitmentTotals(context) : Promise.resolve([]),
    overviewCounts(context, visible, now),
    baseCurrency(context.companyId),
  ]);

  return {
    baseCurrency: currency,
    receivables: receivables.outstanding,
    overdueReceivables: receivables.overdue,
    payables,
    cashIn: cash.in,
    cashOut: cash.out,
    netCashflow: netOf(cash.in, cash.out),
    openCommitments: commitments,
    counts,
    visible,
  };
}

/* -------------------------------------------------------------------------- */
/* Receivables (PRD #15 §250)                                                  */
/* -------------------------------------------------------------------------- */

function emptyReceivables() {
  return Promise.resolve({ outstanding: [] as CurrencyTotal[], overdue: [] as CurrencyTotal[] });
}

/**
 * Outstanding on sent invoices, grouped by currency.
 *
 * Two aggregates rather than a row-by-row walk: the invoice totals grouped by
 * currency, minus the recorded receipts grouped by currency (PRD #15 §249).
 */
async function receivableTotals(context: UserContext, now: Date) {
  const scope = buildInvoiceScopeWhere(context);
  const sent: Prisma.InvoiceWhereInput = { AND: [scope, { status: "SENT" }] };

  const [invoiced, received, overdueInvoiced, overdueReceived] = await Promise.all([
    prisma.invoice.groupBy({ by: ["currency"], where: sent, _sum: { totalAmount: true } }),
    prisma.payment.groupBy({
      by: ["currency"],
      where: { status: "RECORDED", direction: "RECEIPT", invoice: { is: sent } },
      _sum: { amount: true },
    }),
    prisma.invoice.groupBy({
      by: ["currency"],
      where: { AND: [scope, { status: "SENT", dueDate: { lt: now } }] },
      _sum: { totalAmount: true },
    }),
    prisma.payment.groupBy({
      by: ["currency"],
      where: {
        status: "RECORDED",
        direction: "RECEIPT",
        invoice: { is: { AND: [scope, { status: "SENT", dueDate: { lt: now } }] } },
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    outstanding: difference(invoiced, "totalAmount", received, "amount"),
    overdue: difference(overdueInvoiced, "totalAmount", overdueReceived, "amount"),
  };
}

/* -------------------------------------------------------------------------- */
/* Payables (PRD #15 §251)                                                     */
/* -------------------------------------------------------------------------- */

async function payableTotals(context: UserContext): Promise<CurrencyTotal[]> {
  const scope = buildExpenseScopeWhere(context);
  const approved: Prisma.ExpenseWhereInput = { AND: [scope, { status: "APPROVED" }] };

  const [incurred, paid] = await Promise.all([
    prisma.expense.groupBy({ by: ["currency"], where: approved, _sum: { totalAmount: true } }),
    prisma.payment.groupBy({
      by: ["currency"],
      where: { status: "RECORDED", direction: "DISBURSEMENT", expense: { is: approved } },
      _sum: { amount: true },
    }),
  ]);

  return difference(incurred, "totalAmount", paid, "amount");
}

/* -------------------------------------------------------------------------- */
/* Cashflow (PRD #15 §252–§254)                                                */
/* -------------------------------------------------------------------------- */

async function cashTotals(context: UserContext, from: Date) {
  const scope = buildPaymentScopeWhere(context);

  const [received, paid] = await Promise.all([
    prisma.payment.groupBy({
      by: ["currency"],
      where: {
        AND: [scope, { status: "RECORDED", direction: "RECEIPT", paymentDate: { gte: from } }],
      },
      _sum: { amount: true },
    }),
    prisma.payment.groupBy({
      by: ["currency"],
      where: {
        AND: [
          scope,
          { status: "RECORDED", direction: "DISBURSEMENT", paymentDate: { gte: from } },
        ],
      },
      _sum: { amount: true },
    }),
  ]);

  return { in: totals(received, "amount"), out: totals(paid, "amount") };
}

async function openCommitmentTotals(context: UserContext): Promise<CurrencyTotal[]> {
  const rows = await prisma.commitment.groupBy({
    by: ["currency"],
    where: { AND: [buildCommitmentScopeWhere(context), { status: "APPROVED" }] },
    _sum: { amount: true },
  });

  return totals(rows, "amount");
}

/* -------------------------------------------------------------------------- */
/* Counters                                                                    */
/* -------------------------------------------------------------------------- */

async function overviewCounts(
  context: UserContext,
  visible: FinanceOverviewDTO["visible"],
  now: Date,
) {
  const invoiceScope = buildInvoiceScopeWhere(context);
  const expenseScope = buildExpenseScopeWhere(context);

  const [draftInvoices, pendingApprovals, overdueInvoices, unpaidExpenses] = await Promise.all([
    can(context, "finance.invoice.view")
      ? prisma.invoice.count({ where: { AND: [invoiceScope, { status: "DRAFT" }] } })
      : Promise.resolve(0),
    visible.approvals ? countPendingApprovals(context) : Promise.resolve(0),
    can(context, "finance.invoice.view")
      ? prisma.invoice.count({
          where: { AND: [invoiceScope, { status: "SENT", dueDate: { lt: now } }] },
        })
      : Promise.resolve(0),
    can(context, "finance.expense.view")
      ? prisma.expense.count({ where: { AND: [expenseScope, { status: "APPROVED" }] } })
      : Promise.resolve(0),
  ]);

  return { draftInvoices, pendingApprovals, overdueInvoices, unpaidExpenses };
}

/* -------------------------------------------------------------------------- */
/* Currency-grouped arithmetic                                                 */
/* -------------------------------------------------------------------------- */

type GroupRow = { currency: string; _sum: Record<string, Prisma.Decimal | null> };

function totals(rows: GroupRow[], field: string): CurrencyTotal[] {
  return rows
    .map((row) => ({ currency: row.currency, value: row._sum[field] ?? ZERO }))
    .filter((entry) => !entry.value.isZero())
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((entry) => ({ currency: entry.currency, amount: toAmountString(entry.value) }));
}

/**
 * `left - right`, currency by currency, never below zero.
 *
 * A negative outstanding would mean somebody overpaid, which V0.1 refuses at
 * the point of payment — so if one ever appears here it is a bug, and showing
 * it as zero is better than showing a negative receivable (PRD #15 §79).
 */
function difference(
  left: GroupRow[],
  leftField: string,
  right: GroupRow[],
  rightField: string,
): CurrencyTotal[] {
  const byCurrency = new Map<string, Money>();

  for (const row of left) {
    byCurrency.set(row.currency, row._sum[leftField] ?? ZERO);
  }
  for (const row of right) {
    const current = byCurrency.get(row.currency) ?? ZERO;
    byCurrency.set(row.currency, subtract(current, row._sum[rightField] ?? ZERO));
  }

  return [...byCurrency.entries()]
    .map(([currency, value]) => ({ currency, value: clampAtZero(value) }))
    .filter((entry) => !entry.value.isZero())
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((entry) => ({ currency: entry.currency, amount: toAmountString(entry.value) }));
}

/** Net cashflow may legitimately be negative: the company spent more than it took. */
function netOf(cashIn: CurrencyTotal[], cashOut: CurrencyTotal[]): CurrencyTotal[] {
  const byCurrency = new Map<string, Money>();

  for (const entry of cashIn) {
    byCurrency.set(entry.currency, new Prisma.Decimal(entry.amount));
  }
  for (const entry of cashOut) {
    const current = byCurrency.get(entry.currency) ?? ZERO;
    byCurrency.set(entry.currency, subtract(current, entry.amount));
  }

  return [...byCurrency.entries()]
    .filter(([, value]) => !value.isZero())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => ({ currency, amount: toAmountString(value) }));
}
