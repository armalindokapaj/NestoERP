import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { buildExpenseScopeWhere } from "../finance.scope";
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

export async function listExpenses(context: UserContext, query: ExpenseListQuery) {
  const where = buildExpenseListWhere(context, query);

  const [rows, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SUMMARY_SELECT,
    }),
    prisma.expense.count({ where }),
  ]);

  return { rows, total };
}

/**
 * The Group workspace's expense list (Workspace Context §36, §58): the union of
 * each company's own list clause, applied before sort and pagination, with `id`
 * as the tiebreaker so a page holds still.
 */
export async function listExpensesAcross(contexts: UserContext[], query: ExpenseListQuery) {
  if (contexts.length === 0) return { rows: [], total: 0 };
  const where: Prisma.ExpenseWhereInput = { OR: contexts.map((context) => buildExpenseListWhere(context, query)) };

  const [rows, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [...ORDER[query.sort], { id: "asc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: { ...SUMMARY_SELECT, companyId: true },
    }),
    prisma.expense.count({ where }),
  ]);

  return { rows, total };
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
