import type { ExpenseStatus } from "@prisma/client";

/**
 * Expense workflow transitions (PRD #15 §246).
 *
 * ARCHIVED is unreachable here for the same reason it is on invoices: archiving
 * is its own action, and restore reads `preArchiveStatus` (PRD #15 §102).
 *
 * `APPROVED → CANCELLED` carries a second condition the table cannot express —
 * no recorded payments — which the service checks (PRD #15 §101).
 */
const TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  // DRAFT: returned for revision (PRD #41 §48).
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["CANCELLED"],
  REJECTED: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"],
  CANCELLED: [],
  ARCHIVED: [],
};

export function canTransitionExpense(from: ExpenseStatus, to: ExpenseStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export const EDITABLE_EXPENSE_STATUSES: ExpenseStatus[] = ["DRAFT", "REJECTED"];

export function isExpenseEditable(status: ExpenseStatus): boolean {
  return EDITABLE_EXPENSE_STATUSES.includes(status);
}

export function isExpenseSubmittable(status: ExpenseStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

/**
 * Approved cost stays visible (PRD #15 §102).
 *
 * An approved expense is what "actual cost" is calculated from; hiding it would
 * silently change every budget-vs-actual figure that depends on it.
 */
export const ARCHIVABLE_EXPENSE_STATUSES: ExpenseStatus[] = ["DRAFT", "REJECTED", "CANCELLED"];

export function isExpenseArchivable(status: ExpenseStatus): boolean {
  return ARCHIVABLE_EXPENSE_STATUSES.includes(status);
}

export const CANCELLABLE_EXPENSE_STATUSES: ExpenseStatus[] = ["DRAFT", "REJECTED", "APPROVED"];

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
