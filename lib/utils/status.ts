/**
 * Status vocabulary (PRD #7 §33, §92).
 *
 * Each resource keeps its own statuses — there is deliberately no universal
 * status enum — but they share one presentation: a tone and a readable label.
 * Colour reinforces meaning and never carries it alone, so the label is always
 * rendered (PRD #7 §156).
 *
 * Pure logic, deliberately free of JSX: the server-side record registry reads
 * these labels while building query results.
 */
export type StatusTone = "default" | "neutral" | "success" | "warning" | "danger" | "info";

const TONES: Record<string, StatusTone> = {
  /* Neutral / draft */
  DRAFT: "default",
  ARCHIVED: "default",
  INACTIVE: "default",
  LOST: "default",
  EXPIRED: "default",
  NONE: "default",

  /* In flight */
  ACTIVE: "success",
  PLANNED: "neutral",
  PRESENT: "success",
  REMOTE: "info",
  ON_LEAVE: "info",
  IN_PROGRESS: "info",
  ORDERED: "info",
  SUBMITTED: "info",
  QUALIFIED: "info",
  PROPOSAL: "info",
  NEGOTIATION: "info",
  OPEN: "info",
  TODO: "neutral",
  LEAD: "neutral",
  INVITED: "warning",

  /* Waiting on somebody */
  PENDING: "warning",
  PENDING_APPROVAL: "warning",
  ON_HOLD: "warning",
  EXPIRING: "warning",
  REVIEW: "warning",

  /* Settled */
  APPROVED: "success",
  PAID: "success",
  COMPLETED: "success",
  CLOSED: "success",
  DELIVERED: "success",
  WON: "success",
  RESOLVED: "success",

  /* Settled, without a verdict */
  ENDED: "default",
  CANCELLED: "default",
  HOLIDAY: "neutral",
  OFF: "default",
  NOT_STARTED: "default",
  NOT_REQUIRED: "default",

  /* Wrong */
  OVERDUE: "danger",
  ABSENT: "danger",
  BLOCKED: "danger",
  REJECTED: "danger",
  SUSPENDED: "danger",
};

const LABELS: Record<string, string> = {
  ON_HOLD: "On hold",
  ON_LEAVE: "On leave",
  NOT_STARTED: "Not started",
  NOT_REQUIRED: "Not required",
  IN_PROGRESS: "In progress",
  PENDING_APPROVAL: "Pending approval",
  PUNCH_ITEM: "Punch item",
  CORRECTIVE_ACTION: "Corrective action",
  NCR: "NCR",
  TODO: "To do",
  QAQC: "QA/QC",
  HSE: "HSE",
  HR: "HR",
};

export function statusLabel(status: string): string {
  if (LABELS[status]) return LABELS[status];

  return status
    .toLowerCase()
    .split("_")
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function statusTone(status: string): StatusTone {
  return TONES[status] ?? "default";
}

/** Priority and severity share a vocabulary; Critical must read clearly. */
export const PRIORITY_TONES: Record<string, StatusTone> = {
  LOW: "default",
  MEDIUM: "neutral",
  HIGH: "warning",
  CRITICAL: "danger",
};
