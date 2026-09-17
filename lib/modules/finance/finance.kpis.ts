import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { clampAtZero, subtract, ZERO, type Money } from "./finance.money";
import { buildExpenseScopeWhere, buildInvoiceScopeWhere } from "./finance.scope";
import { baseCurrency } from "./finance.settings";
import { LIVE_ALLOCATION } from "./finance.settlement";

/**
 * Single-number finance figures for the role dashboards (PRD #4, PRD #15 §259).
 *
 * The dashboards need one amount, not a currency-grouped table, so these report
 * the company's *base currency* only and say so. Adding a USD invoice into a
 * EUR total would be arithmetic that means nothing, and V0.1 has no FX engine
 * (PRD #15 §36).
 *
 * They use the same scope clauses and the same settlement definition as the
 * Finance module itself, so a dashboard figure and the Finance overview can
 * never disagree (PRD #15 §258).
 */

export type FinanceKpi = { amount: Money; currency: string };

/** Outstanding on sent invoices (PRD #15 §250). */
export async function receivablesKpi(context: UserContext): Promise<FinanceKpi> {
  const currency = await baseCurrency(context.companyId);
  const where: Prisma.InvoiceWhereInput = {
    AND: [buildInvoiceScopeWhere(context), { status: "SENT", currency }],
  };

  return { amount: await outstandingOnInvoices(where), currency };
}

/** Outstanding on sent invoices already past their due date (PRD #15 §44). */
export async function overdueReceivablesKpi(context: UserContext): Promise<FinanceKpi> {
  const currency = await baseCurrency(context.companyId);
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      buildInvoiceScopeWhere(context),
      { status: "SENT", currency, dueDate: { lt: new Date() } },
    ],
  };

  return { amount: await outstandingOnInvoices(where), currency };
}

/** Everything raised and still standing — draft and cancelled excluded. */
export async function invoicedValueKpi(context: UserContext): Promise<FinanceKpi> {
  const currency = await baseCurrency(context.companyId);

  const result = await prisma.invoice.aggregate({
    where: {
      AND: [
        buildInvoiceScopeWhere(context),
        { currency, status: { in: ["APPROVED", "SENT"] } },
      ],
    },
    _sum: { totalAmount: true },
  });

  return { amount: result._sum.totalAmount ?? ZERO, currency };
}

/** Approved cost, which is what "actual" means everywhere else (PRD #15 §118). */
export async function actualCostKpi(context: UserContext): Promise<FinanceKpi> {
  const currency = await baseCurrency(context.companyId);

  const result = await prisma.expense.aggregate({
    where: { AND: [buildExpenseScopeWhere(context), { currency, status: "APPROVED" }] },
    _sum: { totalAmount: true },
  });

  return { amount: result._sum.totalAmount ?? ZERO, currency };
}

/** Invoiced value grouped by project, for the project-value widget. */
export async function invoicedByProject(context: UserContext) {
  const currency = await baseCurrency(context.companyId);

  const rows = await prisma.invoice.groupBy({
    by: ["projectId"],
    where: {
      AND: [
        buildInvoiceScopeWhere(context),
        { currency, projectId: { not: null }, status: { in: ["APPROVED", "SENT"] } },
      ],
    },
    _sum: { totalAmount: true },
  });

  return { currency, rows };
}

async function outstandingOnInvoices(where: Prisma.InvoiceWhereInput): Promise<Money> {
  // What is allocated to these invoices (E-05F §31), against what they total.
  const [invoiced, received] = await Promise.all([
    prisma.invoice.aggregate({ where, _sum: { totalAmount: true } }),
    prisma.paymentAllocation.aggregate({
      where: { ...LIVE_ALLOCATION, invoice: { is: where } },
      _sum: { amount: true },
    }),
  ]);

  return clampAtZero(
    subtract(invoiced._sum?.totalAmount ?? ZERO, received._sum?.amount ?? ZERO),
  );
}
