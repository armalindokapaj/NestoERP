import type { BudgetStatus } from "@prisma/client";

import { canMove, transitionFor } from "@/lib/core/state/machine";
import { projectBudgetMachine, type ProjectBudgetTransitionAction } from "./budget.machine";

/** The statuses an action on the budget machine is legal from. */
function legalFrom(action: ProjectBudgetTransitionAction): BudgetStatus[] {
  return [...transitionFor(projectBudgetMachine, action)!.from];
}

/**
 * The workflow, without archive and restore (PRD #15 §247).
 *
 * Both are actions on the machine, but neither is a step in the workflow:
 * archiving has its own guard, and restore reads `preArchiveStatus` rather than
 * picking a status to land on.
 */
const WORKFLOW = {
  ...projectBudgetMachine,
  transitions: projectBudgetMachine.transitions.filter((transition) => transition.action !== "archive" && transition.action !== "restore"),
};

/**
 * Whether the workflow moves a budget from one status to another, answered
 * from `projectBudgetMachine` so there is one table rather than two that can
 * drift. A status counts as moving to itself, as it always has here.
 *
 * An approved budget has no outgoing transition at all: the only way forward
 * is a revision, which is a new version rather than a change to this one
 * (PRD #15 §111, §115).
 */
export function canTransitionBudget(from: BudgetStatus, to: BudgetStatus): boolean {
  if (from === to) return true;
  return canMove(WORKFLOW, from, to);
}

export const EDITABLE_BUDGET_STATUSES: BudgetStatus[] = ["DRAFT", "REJECTED"];

export function isBudgetEditable(status: BudgetStatus): boolean {
  return EDITABLE_BUDGET_STATUSES.includes(status);
}

const SUBMITTABLE_BUDGET_STATUSES = legalFrom("submit");

export function isBudgetSubmittable(status: BudgetStatus): boolean {
  return SUBMITTABLE_BUDGET_STATUSES.includes(status);
}

/**
 * The current approved budget can never be archived (PRD #15 §116).
 *
 * It is the denominator of every variance figure on the project; archiving it
 * would leave those numbers divided by nothing.
 */
export const ARCHIVABLE_BUDGET_STATUSES: BudgetStatus[] = legalFrom("archive");

export function isBudgetArchivable(budget: { status: BudgetStatus; isCurrent: boolean }): boolean {
  if (budget.isCurrent) return false;
  return ARCHIVABLE_BUDGET_STATUSES.includes(budget.status);
}

/** A version still being worked on. At most one per project (PRD #15 §110). */
export const OPEN_BUDGET_STATUSES: BudgetStatus[] = ["DRAFT", "PENDING_APPROVAL"];

export function isBudgetOpen(status: BudgetStatus): boolean {
  return OPEN_BUDGET_STATUSES.includes(status);
}

export const budgetStatusLabels: Record<BudgetStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
};

/**
 * Budget risk (PRD #15 §123).
 *
 * Display logic, computed on read. It is deliberately not a persisted status:
 * a project does not "become" critical, its forecast does, and that changes
 * every time an expense is approved.
 */
export type BudgetRisk = "GREEN" | "WARNING" | "CRITICAL";

export function budgetRisk(forecastPercent: number | null): BudgetRisk | null {
  if (forecastPercent === null) return null;
  if (forecastPercent > 100) return "CRITICAL";
  if (forecastPercent > 90) return "WARNING";
  return "GREEN";
}

export const budgetRiskLabels: Record<BudgetRisk, string> = {
  GREEN: "On budget",
  WARNING: "Near budget",
  CRITICAL: "Over budget",
};
