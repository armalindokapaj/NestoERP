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
  INVITED: "warning",
  /* Sales pipeline stages (PRD #17 §278, §289) — subtle accents, not a
     rainbow: a board where every column shouts tells the reader nothing. */
  PROSPECTING: "neutral",
  DISCOVERY: "info",
  NEW: "neutral",
  CONTACTED: "info",
  SENT: "info",

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
  DECLINED: "default",
  DISQUALIFIED: "default",
  CONVERTED: "success",
  ACCEPTED: "success",
  HOLIDAY: "neutral",
  OFF: "default",
  NOT_STARTED: "default",
  NOT_REQUIRED: "default",

  /* Quality (PRD #21 §65) — a verdict is not a stage */
  NOT_SET: "default",
  PASS: "success",
  FAIL: "danger",
  CONDITIONAL: "warning",
  NA: "default",
  VERIFIED: "success",
  PENDING_VERIFICATION: "warning",
  APPROVED_FOR_CLOSE: "info",
  REOPENED: "warning",
  ASSIGNED: "info",
  HELD: "warning",
  REVOKED: "default",
  PARTIALLY_RELEASED: "info",

  /* Stock documents and levels (PRD #20 §329) */
  POSTED: "success",
  REVERSED: "default",
  RELEASED: "default",
  FULFILLED: "success",
  PARTIALLY_FULFILLED: "info",
  PARTIALLY_RECEIVED: "info",
  RECEIVED: "success",
  OK: "success",
  LOW: "warning",
  NOT_TRACKED: "default",

  /* Wrong */
  OVERDUE: "danger",
  ABSENT: "danger",
  BLOCKED: "danger",
  REJECTED: "danger",
  SUSPENDED: "danger",
  OUT_OF_STOCK: "danger",
  BELOW_MINIMUM: "danger",
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
  NO_BUDGET: "No budget",
  NO_RESPONSE: "No response",
  SCOPE_MISMATCH: "Scope mismatch",
  INTERNAL_DECISION: "Internal decision",
  NOT_SET: "No result yet",
  NA: "N/A",
  PENDING_VERIFICATION: "Pending verification",
  APPROVED_FOR_CLOSE: "Approved for close",
  PARTIALLY_RELEASED: "Partly released",
  PASS_FAIL: "Pass / fail",
  PASS_FAIL_NA: "Pass / fail / N/A",
  PARTIALLY_FULFILLED: "Partly fulfilled",
  PARTIALLY_RECEIVED: "Partly received",
  OUT_OF_STOCK: "Out of stock",
  BELOW_MINIMUM: "Below minimum",
  NOT_TRACKED: "No threshold set",
  OK: "In stock",
  RETURN_TO_STOCK: "Return to stock",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTMENT_IN: "Adjustment in",
  ADJUSTMENT_OUT: "Adjustment out",
  OPENING_BALANCE: "Opening balance",
  PHYSICAL_COUNT: "Physical count",
  PROJECT_SITE: "Project site",
  SPARE_PART: "Spare part",
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
