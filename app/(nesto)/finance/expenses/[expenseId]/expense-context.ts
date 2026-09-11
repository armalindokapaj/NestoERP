import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import type { ExpenseDetailDTO } from "@/lib/modules/finance/finance.types";

/** Loads an expense for every page under /finance/expenses/[expenseId]. */
export async function loadExpense(
  expenseId: string,
): Promise<{ context: UserContext; expense: ExpenseDetailDTO }> {
  const context = await requireModule("finance");

  try {
    return { context, expense: await expenses.getExpense(context, expenseId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function expenseLabel(expense: ExpenseDetailDTO): string {
  return expense.expenseNumber ?? expense.description;
}

export function expenseBreadcrumbs(expense: ExpenseDetailDTO, trailing?: string): Crumb[] {
  const label = expenseLabel(expense);
  const crumbs: Crumb[] = [
    { label: "Finance", href: "/finance" },
    { label: "Expenses", href: "/finance/expenses" },
    trailing ? { label, href: `/finance/expenses/${expense.id}` } : { label },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
