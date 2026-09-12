import type { ContractObligationStatus, ContractObligationType } from "@prisma/client";

/**
 * Obligation state (PRD #18 §152, §295, §338).
 *
 * OVERDUE is not a status. An obligation is overdue when it is still open and
 * its due date has passed — a fact about today that would be wrong every night
 * at midnight if it were stored (PRD #18 §152).
 */

export const OBLIGATION_STATUSES = ["OPEN", "COMPLETED", "CANCELLED"] as const;

export const OBLIGATION_TYPES = [
  "DELIVERABLE",
  "NOTICE",
  "PAYMENT",
  "DOCUMENT",
  "COMPLIANCE",
  "RENEWAL",
  "OTHER",
] as const;

export const obligationStatusLabels: Record<ContractObligationStatus, string> = {
  OPEN: "Open",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const obligationTypeLabels: Record<ContractObligationType, string> = {
  DELIVERABLE: "Deliverable",
  NOTICE: "Notice",
  PAYMENT: "Payment",
  DOCUMENT: "Document",
  COMPLIANCE: "Compliance",
  RENEWAL: "Renewal",
  OTHER: "Other",
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function isObligationOverdue(
  obligation: { status: ContractObligationStatus; dueDate: Date | null },
  today: Date,
): boolean {
  if (obligation.status !== "OPEN" || !obligation.dueDate) return false;
  return startOfDay(obligation.dueDate).getTime() < startOfDay(today).getTime();
}

export function daysOverdue(
  obligation: { status: ContractObligationStatus; dueDate: Date | null },
  today: Date,
): number {
  if (!isObligationOverdue(obligation, today)) return 0;
  return Math.round(
    (startOfDay(today).getTime() - startOfDay(obligation.dueDate!).getTime()) / DAY,
  );
}

/** Only an open obligation can be completed or cancelled (PRD #18 §156, §157). */
export function canCloseObligation(status: ContractObligationStatus): boolean {
  return status === "OPEN";
}

export type ObligationDueBucket =
  | "OVERDUE"
  | "DUE_TODAY"
  | "NEXT_7_DAYS"
  | "NEXT_30_DAYS"
  | "LATER"
  | "NO_DUE_DATE";

export const obligationBucketLabels: Record<ObligationDueBucket, string> = {
  OVERDUE: "Overdue",
  DUE_TODAY: "Due today",
  NEXT_7_DAYS: "Next 7 days",
  NEXT_30_DAYS: "Next 30 days",
  LATER: "Later",
  NO_DUE_DATE: "No due date",
};

export const OBLIGATION_BUCKETS: ObligationDueBucket[] = [
  "OVERDUE",
  "DUE_TODAY",
  "NEXT_7_DAYS",
  "NEXT_30_DAYS",
  "LATER",
  "NO_DUE_DATE",
];

/** Where an obligation sits on the attention list (PRD #18 §338). */
export function obligationDueBucket(
  obligation: { status: ContractObligationStatus; dueDate: Date | null },
  today: Date,
): ObligationDueBucket {
  if (!obligation.dueDate) return "NO_DUE_DATE";

  const days = Math.round(
    (startOfDay(obligation.dueDate).getTime() - startOfDay(today).getTime()) / DAY,
  );

  if (days < 0) return obligation.status === "OPEN" ? "OVERDUE" : "LATER";
  if (days === 0) return "DUE_TODAY";
  if (days <= 7) return "NEXT_7_DAYS";
  if (days <= 30) return "NEXT_30_DAYS";
  return "LATER";
}
