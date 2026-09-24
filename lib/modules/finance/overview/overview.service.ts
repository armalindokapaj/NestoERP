import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import { inGroupWorkspace } from "@/config/workspace";
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
import { paidByExpense, paidByInvoice } from "../finance.settlement";
import type { CurrencyTotal, FinanceOverviewDTO, GroupFinanceOverviewDTO } from "../finance.types";
import { companyOf, financeContexts, mergeCurrencyTotals } from "../finance.workspace";

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

/**
 * What this reader may see on the overview, from permissions alone (NAV-03
 * STREAM-05): the exact predicates the overview has always used, including
 * the compound receivables/invoice, payables/expense and cashflow/payment
 * grants, and one reporting time for every figure.
 */
export type FinanceOverviewPlan = { now: Date; monthStart: Date; visible: FinanceOverviewDTO["visible"] };

export function planFinanceOverview(context: UserContext, options: { now?: Date } = {}): FinanceOverviewPlan {
  assertModule(context, MODULE);
  assertPermission(context, "finance.dashboard.view");
  const now = options.now ?? new Date();
  return {
    now,
    monthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    visible: {
      receivables: can(context, "finance.receivables.view") && can(context, "finance.invoice.view"),
      payables: can(context, "finance.payables.view") && can(context, "finance.expense.view"),
      cashflow: can(context, "finance.cashflow.view") && can(context, "finance.payment.view"),
      commitments: can(context, "finance.commitment.view"),
      approvals: can(context, "finance.approval.view"),
      projectBudgets: can(context, "finance.project_budget.view"),
    },
  };
}

/**
 * Each financial domain's read, started together and awaited apart, so the
 * page can show one while another is still on its way. A domain the plan does
 * not show is never read.
 */
export function loadFinanceOverviewDomains(context: UserContext, plan: FinanceOverviewPlan) {
  const { visible, now, monthStart } = plan;
  return {
    receivables: visible.receivables ? receivableTotals(context, now) : emptyReceivables(),
    payables: visible.payables ? payableTotals(context) : Promise.resolve([]),
    cash: visible.cashflow ? cashTotals(context, monthStart) : Promise.resolve({ in: [], out: [] }),
    commitments: visible.commitments ? openCommitmentTotals(context) : Promise.resolve([]),
    counts: overviewCounts(context, visible, now),
    baseCurrency: baseCurrency(context.companyId),
  };
}

export async function getFinanceOverview(
  context: UserContext,
  options: { now?: Date } = {},
): Promise<FinanceOverviewDTO> {
  const plan = planFinanceOverview(context, options);
  const domains = loadFinanceOverviewDomains(context, plan);
  const [receivables, payables, cash, commitments, counts, currency] = await Promise.all([
    domains.receivables,
    domains.payables,
    domains.cash,
    domains.commitments,
    domains.counts,
    domains.baseCurrency,
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
    visible: plan.visible,
  };
}

/**
 * The overview of the active workspace (Workspace Context §36, §72): a company
 * workspace is `getFinanceOverview`, untouched; the Group workspace is
 * `getGroupFinanceOverview`.
 */
export async function getFinanceOverviewForWorkspace(
  session: UserContext,
  options: { now?: Date } = {},
): Promise<FinanceOverviewDTO | GroupFinanceOverviewDTO> {
  return inGroupWorkspace(session) ? getGroupFinanceOverview(session, options) : getFinanceOverview(session, options);
}

/**
 * The group's Finance overview: every company the reader may open the overview
 * in answers as itself, on one clock, and the group is those answers together.
 *
 * Nothing is asked of a company where Finance is off or where the reader lacks
 * the permission, so nothing of it can reach a total (§60, §92). Amounts are
 * added only within a currency; what cannot be — a base currency, a company's
 * own picture — stays a per-company row (§72).
 */
export async function getGroupFinanceOverview(
  session: UserContext,
  options: { now?: Date } = {},
): Promise<GroupFinanceOverviewDTO> {
  // A group with no company to read is an empty overview, not an error (§76).
  const contexts = await financeContexts(session, "finance.dashboard.view");

  const now = options.now ?? new Date();
  const companies = await Promise.all(
    contexts.map(async (context) => ({ company: companyOf(context), overview: await getFinanceOverview(context, { now }) })),
  );
  const overviews = companies.map((row) => row.overview);
  const sum = (pick: (overview: FinanceOverviewDTO) => CurrencyTotal[]) => mergeCurrencyTotals(overviews.map(pick));
  const count = (key: keyof FinanceOverviewDTO["counts"]) => overviews.reduce((total, overview) => total + overview.counts[key], 0);
  const anywhere = (key: keyof FinanceOverviewDTO["visible"]) => overviews.some((overview) => overview.visible[key]);

  return {
    scope: "GROUP",
    companies,
    totals: {
      receivables: sum((overview) => overview.receivables),
      overdueReceivables: sum((overview) => overview.overdueReceivables),
      payables: sum((overview) => overview.payables),
      cashIn: sum((overview) => overview.cashIn),
      cashOut: sum((overview) => overview.cashOut),
      netCashflow: sum((overview) => overview.netCashflow),
      openCommitments: sum((overview) => overview.openCommitments),
    },
    counts: {
      draftInvoices: count("draftInvoices"),
      pendingApprovals: count("pendingApprovals"),
      overdueInvoices: count("overdueInvoices"),
      unpaidExpenses: count("unpaidExpenses"),
    },
    visible: {
      receivables: anywhere("receivables"),
      payables: anywhere("payables"),
      cashflow: anywhere("cashflow"),
      commitments: anywhere("commitments"),
      approvals: anywhere("approvals"),
      projectBudgets: anywhere("projectBudgets"),
    },
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
 * Each sent invoice's outstanding balance — its total less what is allocated to
 * it (E-05F §31) — summed by currency. Two queries whatever the number of
 * invoices: the sent invoices in scope, and one grouped aggregate of their
 * allocations (PRD #15 §249).
 */
async function receivableTotals(context: UserContext, now: Date) {
  const sent: Prisma.InvoiceWhereInput = { AND: [buildInvoiceScopeWhere(context), { status: "SENT" }] };
  const invoices = await prisma.invoice.findMany({ where: sent, select: { id: true, currency: true, totalAmount: true, dueDate: true } });
  const paid = await paidByInvoice(invoices.map((invoice) => invoice.id));

  const outstanding = new Map<string, Money>();
  const overdue = new Map<string, Money>();
  for (const invoice of invoices) {
    const owed = clampAtZero(subtract(invoice.totalAmount, paid.get(invoice.id) ?? ZERO));
    outstanding.set(invoice.currency, (outstanding.get(invoice.currency) ?? ZERO).plus(owed));
    if (invoice.dueDate < now) overdue.set(invoice.currency, (overdue.get(invoice.currency) ?? ZERO).plus(owed));
  }

  return { outstanding: currencyTotals(outstanding), overdue: currencyTotals(overdue) };
}

function currencyTotals(values: Map<string, Money>): CurrencyTotal[] {
  return [...values.entries()]
    .filter(([, value]) => !value.isZero())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => ({ currency, amount: toAmountString(value) }));
}

/* -------------------------------------------------------------------------- */
/* Payables (PRD #15 §251)                                                     */
/* -------------------------------------------------------------------------- */

async function payableTotals(context: UserContext): Promise<CurrencyTotal[]> {
  const approved: Prisma.ExpenseWhereInput = { AND: [buildExpenseScopeWhere(context), { status: "APPROVED" }] };
  const expenses = await prisma.expense.findMany({ where: approved, select: { id: true, currency: true, totalAmount: true } });
  const paid = await paidByExpense(expenses.map((expense) => expense.id));

  const owed = new Map<string, Money>();
  for (const expense of expenses) {
    owed.set(expense.currency, (owed.get(expense.currency) ?? ZERO).plus(clampAtZero(subtract(expense.totalAmount, paid.get(expense.id) ?? ZERO))));
  }
  return currencyTotals(owed);
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

/** Net cashflow may legitimately be negative: the company spent more than it took. */
export function netOf(cashIn: CurrencyTotal[], cashOut: CurrencyTotal[]): CurrencyTotal[] {
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
