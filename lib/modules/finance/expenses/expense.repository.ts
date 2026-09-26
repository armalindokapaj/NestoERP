import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { searchClause } from "@/lib/modules/shared/list-query";
import { readRegisterSnapshot, registerSlice, registerSummary, type RegisterWindow } from "../finance.register";
import { buildExpenseScopeWhere } from "../finance.scope";
import { expenseSettlementWhere } from "../invoices/invoice.status";
import type { ExpenseListQuery, ExpenseSortKey } from "./expense.schema";

/** Expense queries (PRD #15 §167, §168, §263). */

const ORDER: Record<ExpenseSortKey, Prisma.ExpenseOrderByWithRelationInput[]> = {
  "date-desc": [{ expenseDate: "desc" }],
  "date-asc": [{ expenseDate: "asc" }],
  "amount-desc": [{ totalAmount: "desc" }],
  "amount-asc": [{ totalAmount: "asc" }],
  "updated-desc": [{ updatedAt: "desc" }],
};

export const SUMMARY_SELECT = {
  id: true,
  expenseNumber: true,
  description: true,
  category: true,
  payeeName: true,
  expenseDate: true,
  currency: true,
  netAmount: true,
  taxAmount: true,
  totalAmount: true,
  status: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ExpenseSelect;

export type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof SUMMARY_SELECT }>;

export const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  preArchiveStatus: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  createdByMemberId: true,
} satisfies Prisma.ExpenseSelect;

export type ExpenseDetailRow = Prisma.ExpenseGetPayload<{ select: typeof DETAIL_SELECT }>;

export function buildExpenseListWhere(
  context: UserContext,
  query: ExpenseListQuery,
): Prisma.ExpenseWhereInput {
  const filters: Prisma.ExpenseWhereInput[] = [buildExpenseScopeWhere(context)];

  filters.push(
    query.archived
      ? { status: "ARCHIVED" }
      : { archivedAt: null, status: { not: "ARCHIVED" } },
  );

  const search = searchClause(query.search, ["description", "payeeName", "expenseNumber", "notes"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.ExpenseWhereInput),
        { project: { name: { contains: term, mode: "insensitive" } } },
        { project: { code: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  if (query.status?.length && !query.archived) filters.push({ status: { in: query.status } });
  if (query.category?.length) filters.push({ category: { in: query.category } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.currency) filters.push({ currency: query.currency });
  if (query.incurredFrom) filters.push({ expenseDate: { gte: query.incurredFrom } });
  if (query.incurredTo) filters.push({ expenseDate: { lte: query.incurredTo } });

  return { AND: filters };
}

/** The chosen sort, then the id, so a page holds still (AUD-01 §5.2). */
function registerOrder(sort: ExpenseSortKey): Prisma.ExpenseOrderByWithRelationInput[] {
  return [...ORDER[sort], { id: "asc" }];
}

/** A register row: the summary, its company, and what it has been paid in this snapshot. */
export const REGISTER_SELECT = {
  ...SUMMARY_SELECT,
  companyId: true,
  settlement: { select: { paidAmount: true } },
} satisfies Prisma.ExpenseSelect;

export type ExpenseRegisterRow = Prisma.ExpenseGetPayload<{ select: typeof REGISTER_SELECT }>;

/**
 * The expense register — list, count, filtered totals and export (AUD-01 §4):
 * each company's own list clause, united, filtered by settlement through the
 * settlement view before anything is counted, totalled or paged. The twin of
 * `readInvoiceRegister`.
 */
export async function readExpenseRegister(
  contexts: UserContext[],
  query: ExpenseListQuery,
  read: { evaluatedAt: Date; window: RegisterWindow; timeoutMs?: number },
) {
  // Nothing readable is an empty answer, not an error (Workspace Context §76).
  if (contexts.length === 0) return { rows: [] as ExpenseRegisterRow[], summary: registerSummary("expenses", [], read.evaluatedAt), page: 1 };

  const eligible: Prisma.ExpenseWhereInput =
    contexts.length === 1 ? buildExpenseListWhere(contexts[0], query) : { OR: contexts.map((context) => buildExpenseListWhere(context, query)) };
  const companies: Prisma.ExpenseSettlementWhereInput = { companyId: { in: contexts.map((context) => context.companyId) } };
  const settled = query.settlement?.length ? expenseSettlementWhere(query.settlement) : null;

  return readRegisterSnapshot(
    "expenses",
    async (tx) => {
      const groups = await tx.expenseSettlement.groupBy({
        by: ["currency"],
        _count: { _all: true },
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true, integrityIssues: true },
        orderBy: { currency: "asc" },
        where: { AND: [companies, ...(settled ? [settled] : []), { expense: { is: eligible } }] },
      });
      const summary = registerSummary("expenses", groups, read.evaluatedAt);
      const slice = registerSlice(read.window, summary.matchingCount);

      const rows =
        slice.take === 0
          ? []
          : await tx.expense.findMany({
              where: settled ? { AND: [eligible, { settlement: { is: { AND: [companies, settled] } } }] } : eligible,
              orderBy: registerOrder(query.sort),
              skip: slice.skip,
              take: slice.take,
              select: REGISTER_SELECT,
            });

      return { rows, summary, page: slice.page };
    },
    { timeoutMs: read.timeoutMs },
  );
}

/** One expense's settlement row, for a detail read's integrity check (AUD-01 §3). */
export function expenseSettlementRow(expenseId: string) {
  return prisma.expenseSettlement.findUnique({ where: { expenseId }, select: { integrityIssues: true } });
}

export function findExpenseInScope(context: UserContext, expenseId: string) {
  return prisma.expense.findFirst({
    where: { AND: [buildExpenseScopeWhere(context), { id: expenseId }] },
    select: DETAIL_SELECT,
  });
}

export async function expenseFilterOptions(context: UserContext) {
  const scope = buildExpenseScopeWhere(context);

  const [projects, currencies] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: context.companyId, expenses: { some: scope } },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.expense.findMany({
      where: scope,
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return { projects, currencies: currencies.map((row) => row.currency) };
}

/** Currencies of the expenses the Group workspace reads: no project filter, projects belong to one company. */
export async function expenseCurrenciesAcross(contexts: UserContext[]): Promise<string[]> {
  if (contexts.length === 0) return [];
  const rows = await prisma.expense.findMany({
    where: { OR: contexts.map((context) => buildExpenseScopeWhere(context)) },
    select: { currency: true },
    distinct: ["currency"],
    orderBy: { currency: "asc" },
  });
  return rows.map((row) => row.currency);
}

/** Approved expenses a disbursement may settle. */
export function approvedExpensesInScope(context: UserContext) {
  return prisma.expense.findMany({
    where: { AND: [buildExpenseScopeWhere(context), { status: "APPROVED" }] },
    select: {
      id: true,
      expenseNumber: true,
      description: true,
      currency: true,
      totalAmount: true,
      payeeName: true,
    },
    orderBy: { expenseDate: "asc" },
    take: 200,
  });
}
