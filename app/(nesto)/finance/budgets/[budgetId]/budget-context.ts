import { notFound } from "next/navigation";
import type { Translate } from "@/lib/i18n/translator";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { getTranslations } from "@/lib/i18n/server";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import type { BudgetDetailDTO } from "@/lib/modules/finance/finance.types";

/** Loads a budget for every page under /finance/budgets/[budgetId]. */
export async function loadBudget(
  budgetId: string,
): Promise<{ context: UserContext; budget: BudgetDetailDTO }> {
  const context = await requireModule("finance");

  try {
    return { context, budget: await budgets.getBudget(context, budgetId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function budgetLabel(budget: BudgetDetailDTO, t?: Translate<"finance">): string {
  return t ? t("budgets.label", { code: budget.project.code, version: budget.version }) : `${budget.project.code} budget v${budget.version}`;
}

export async function budgetBreadcrumbs(budget: BudgetDetailDTO, trailing?: string): Promise<Crumb[]> {
  const t = await getTranslations("finance");
  const label = budgetLabel(budget, t);
  const crumbs: Crumb[] = [
    { label: t("crumbs.finance"), href: "/finance" },
    { label: t("crumbs.budgets"), href: "/finance/budgets" },
    trailing ? { label, href: `/finance/budgets/${budget.id}` } : { label },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
