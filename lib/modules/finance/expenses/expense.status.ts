import type { ExpenseStatus } from "@prisma/client";

import { canMove, transitionFor } from "@/lib/core/state/machine";
import { expenseMachine, type ExpenseTransitionAction } from "./expense.machine";

/** The statuses an action on the expense machine is legal from. */
function legalFrom(action: ExpenseTransitionAction): ExpenseStatus[] {
  return [...transitionFor(expenseMachine, action)!.from];
}

/**
 * The workflow, without archive and restore (PRD #15 §246).
 *
 * Both are actions on the machine, but neither is a step in the workflow:
 * archiving has its own guard, and restore reads `preArchiveStatus` rather than
 * picking a status to land on (PRD #15 §102).
 */
const WORKFLOW = {
  ...expenseMachine,
  transitions: expenseMachine.transitions.filter((transition) => transition.action !== "archive" && transition.action !== "restore"),
};

/**
 * Whether the workflow moves an expense from one status to another, answered
 * from `expenseMachine` so there is one table rather than two that can drift.
 * A status counts as moving to itself, as it always has here.
 *
 * `APPROVED → CANCELLED` carries a second condition the table cannot express —
 * no recorded payments — which the service checks (PRD #15 §101).
 */
export function canTransitionExpense(from: ExpenseStatus, to: ExpenseStatus): boolean {
  if (from === to) return true;
  return canMove(WORKFLOW, from, to);
}

export const EDITABLE_EXPENSE_STATUSES: ExpenseStatus[] = ["DRAFT", "REJECTED"];

export function isExpenseEditable(status: ExpenseStatus): boolean {
  return EDITABLE_EXPENSE_STATUSES.includes(status);
}

const SUBMITTABLE_EXPENSE_STATUSES = legalFrom("submit");

export function isExpenseSubmittable(status: ExpenseStatus): boolean {
  return SUBMITTABLE_EXPENSE_STATUSES.includes(status);
}

/**
 * Approved cost stays visible (PRD #15 §102).
 *
 * An approved expense is what "actual cost" is calculated from; hiding it would
 * silently change every budget-vs-actual figure that depends on it.
 */
export const ARCHIVABLE_EXPENSE_STATUSES: ExpenseStatus[] = legalFrom("archive");

export function isExpenseArchivable(status: ExpenseStatus): boolean {
  return ARCHIVABLE_EXPENSE_STATUSES.includes(status);
}

export const CANCELLABLE_EXPENSE_STATUSES: ExpenseStatus[] = legalFrom("cancel");

/** Only an approved expense may be paid out (PRD #15 §100). */
export function acceptsDisbursement(status: ExpenseStatus): boolean {
  return status === "APPROVED";
}

/** Actual cost is recognised at approval, not at payment (PRD #15 §118). */
export function countsAsActualCost(status: ExpenseStatus): boolean {
  return status === "APPROVED";
}

export const expenseStatusLabels: Record<ExpenseStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

export const expenseCategoryLabels = {
  LABOR: "Labour",
  MATERIALS: "Materials",
  EQUIPMENT: "Equipment",
  SUBCONTRACTOR: "Subcontractor",
  SERVICES: "Services",
  TRAVEL: "Travel",
  ADMINISTRATION: "Administration",
  OTHER: "Other",
} as const;
