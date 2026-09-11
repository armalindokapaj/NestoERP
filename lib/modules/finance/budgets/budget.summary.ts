import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { clampAtZero, percentageString, subtract, ZERO, type Money } from "../finance.money";
import { budgetRisk, type BudgetRisk } from "./budget.status";

/**
 * The one budget-vs-actual calculation (PRD #15 §118–§123, §258, §259).
 *
 * Every screen that shows a variance — the project finance tab, the budget
 * list, the budget-vs-actual report, the Finance overview — reads it from here.
 * The alternative is four formulas that agree until one of them is changed.
 *
 * The definitions, stated once:
 *
 *   Actual cost      sum of APPROVED expenses on the project. Approval is when
 *                    a cost is recognised; payment is a cash event that happens
 *                    later and does not change what was spent (PRD #15 §118).
 *   Open commitment  sum of APPROVED commitments. Closed, cancelled and
 *                    archived ones no longer contribute (PRD #15 §119).
 *   Forecast         actual + open commitment (PRD #15 §120).
 *   Remaining        budget - actual - open commitment (PRD #15 §121).
 *   Variance         budget - forecast. Negative means forecast over budget
 *                    (PRD #15 §122).
 */

export type ProjectFinanceNumbers = {
  currency: string;
  budgetAmount: Money;
  actualCost: Money;
  openCommitments: Money;
  forecastCost: Money;
  remaining: Money;
  variance: Money;
  utilizationPercent: string | null;
  risk: BudgetRisk | null;
  hasApprovedBudget: boolean;
};

/**
 * Computes the numbers for a set of projects in three grouped queries.
 *
 * Grouped rather than per project: a budget list with twenty rows must not
 * become sixty-one round trips (PRD #15 §268).
 */
export async function projectFinanceNumbers(
  projectIds: string[],
  fallbackCurrency: string,
  client: Prisma.TransactionClient = prisma,
): Promise<Map<string, ProjectFinanceNumbers>> {
  const result = new Map<string, ProjectFinanceNumbers>();
  if (projectIds.length === 0) return result;

  const [budgets, expenses, commitments] = await Promise.all([
    client.projectBudget.findMany({
      where: { projectId: { in: projectIds }, isCurrent: true, status: "APPROVED" },
      select: { projectId: true, currency: true, totalAmount: true },
    }),
    client.expense.groupBy({
      by: ["projectId", "currency"],
      where: { projectId: { in: projectIds }, status: "APPROVED" },
      _sum: { totalAmount: true },
    }),
    client.commitment.groupBy({
      by: ["projectId", "currency"],
      where: { projectId: { in: projectIds }, status: "APPROVED" },
      _sum: { amount: true },
    }),
  ]);

  const budgetByProject = new Map(budgets.map((row) => [row.projectId, row]));

  for (const projectId of projectIds) {
    const budget = budgetByProject.get(projectId);
    // Without an approved budget the project's own costs still have a
    // currency; the company base currency is the fallback (PRD #15 §34).
    const currency = budget?.currency ?? fallbackCurrency;

    // Only same-currency cost counts toward a budget. A cost in another
    // currency is not converted and not silently added — V0.1 has no FX engine,
    // and a wrong total is worse than a missing one (PRD #15 §36).
    const actualCost =
      expenses.find((row) => row.projectId === projectId && row.currency === currency)?._sum
        .totalAmount ?? ZERO;
    const openCommitments =
      commitments.find((row) => row.projectId === projectId && row.currency === currency)?._sum
        .amount ?? ZERO;

    result.set(projectId, compose(currency, budget?.totalAmount ?? ZERO, actualCost, openCommitments, Boolean(budget)));
  }

  return result;
}

export function compose(
  currency: string,
  budgetAmount: Money,
  actualCost: Money,
  openCommitments: Money,
  hasApprovedBudget: boolean,
): ProjectFinanceNumbers {
  const forecastCost = actualCost.plus(openCommitments);
  const remaining = subtract(subtract(budgetAmount, actualCost), openCommitments);
  const variance = subtract(budgetAmount, forecastCost);

  const utilizationPercent = hasApprovedBudget
    ? percentageString(forecastCost, budgetAmount)
    : null;

  return {
    currency,
    budgetAmount,
    actualCost,
    openCommitments,
    forecastCost,
    remaining,
    variance,
    utilizationPercent,
    risk: budgetRisk(utilizationPercent === null ? null : Number.parseFloat(utilizationPercent)),
    hasApprovedBudget,
  };
}

/** Unused-budget headroom, never negative: an overrun is a variance, not credit. */
export function headroom(numbers: ProjectFinanceNumbers): Money {
  return clampAtZero(numbers.remaining);
}
