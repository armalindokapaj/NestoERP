import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { buildInvoiceScopeWhere } from "@/lib/modules/finance/finance.scope";
import type { CalendarProvider } from "../calendar.types";
import { compact, dateWindow, isPastDue, moduleOpen, onBusinessDate, projectFilter, projectRef, PROJECT_SELECT, SOURCE_LIMIT } from "./provider.helpers";

/**
 * Invoice due dates (PRD #39 §56), for Finance-authorised readers only and
 * through invoice scope. A settled invoice drops off the calendar; one past due
 * with money outstanding is marked as such. Indexed by (companyId, status) and
 * (dueDate).
 */
export const financeProvider: CalendarProvider = {
  key: "finance",
  moduleKey: "finance",
  categories: ["FINANCE"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => moduleOpen(context, "finance", "finance.invoice.view"),
  async getEvents(input) {
    const rows = await prisma.invoice.findMany({
      where: {
        AND: [
          buildInvoiceScopeWhere(input.context),
          { archivedAt: null, status: { in: ["APPROVED", "SENT"] }, dueDate: dateWindow(input) },
          projectFilter(input),
        ],
      },
      take: SOURCE_LIMIT,
      select: { id: true, invoiceNumber: true, status: true, dueDate: true, totalAmount: true, currency: true, project: PROJECT_SELECT },
    });
    if (rows.length === 0) return [];

    // Settled by allocations of payments that still stand (E-05F §31).
    const paid = await prisma.paymentAllocation.groupBy({
      by: ["invoiceId"],
      where: { invoiceId: { in: rows.map((row) => row.id) }, reversedAt: null, payment: { is: { status: "RECORDED" } } },
      _sum: { amount: true },
    });
    const paidBy = new Map(paid.map((row) => [row.invoiceId, row._sum?.amount ?? new Prisma.Decimal(0)]));

    return compact(
      rows.map((row) => {
        const outstanding = row.totalAmount.minus(paidBy.get(row.id) ?? 0);
        if (outstanding.lessThanOrEqualTo(0)) return null;
        const overdue = row.status === "SENT" && isPastDue(row.dueDate, input);
        return onBusinessDate(input, row.dueDate, {
          id: `finance:invoice:${row.id}`,
          sourceType: "invoice",
          sourceId: row.id,
          providerKey: "finance",
          title: `Invoice ${row.invoiceNumber} due`,
          subtitle: `${outstanding.toFixed(2)} ${row.currency} outstanding`,
          category: "FINANCE",
          status: overdue ? "OVERDUE" : row.status,
          severity: overdue ? "warning" : undefined,
          project: projectRef(row.project),
          href: `/finance/invoices/${row.id}`,
          metadata: { sourceLabel: "Invoice", moduleKey: "finance" },
        });
      }),
    );
  },
};
