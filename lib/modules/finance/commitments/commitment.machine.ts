import type { CommitmentStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The commitment lifecycle (PRD #15 §248; PRD #41 §48; PRD #49 §132).
 *
 * Only an approved commitment counts toward forecast. `CLOSED` is how it stops
 * counting once the work has happened and become an expense, `CANCELLED` how
 * it stops counting because it never will (PRD #15 §119, §134).
 *
 * Deciding a commitment is Finance's approval authority rather than the
 * record's own: either the module-wide `finance.approval.decide` or the
 * commitment's own approve or reject grant, as `canApproveType` and
 * `canRejectType` answer it. Returning for revision is a rejection that sends
 * the commitment back to `DRAFT` for a new cycle, so it takes the reject grant.
 * The service also checks, above the write, that a cycle is pending and that
 * nobody decides their own submission.
 *
 * Nothing moves a `REJECTED` commitment back to `DRAFT`: it is corrected where
 * it stands and submitted again.
 *
 * A commitment a purchase order raised is also moved from outside this table,
 * through the door in `commitment.source.ts`: Procurement creates it already
 * `APPROVED`, refreshes it in place, and closes or cancels it with the order —
 * under Procurement's own permissions, since the buyer is not required to hold
 * Finance's (PRD #19 §123, PRD #48 §77). Those writes bind the status they
 * read as these transitions do, but authorisation there is the caller's, so
 * they are not applied through this machine.
 *
 * Restore returns the commitment to the status it was archived from, read from
 * `preArchiveStatus` (PRD #15 §136).
 */
export type CommitmentTransitionAction = "submit" | "approve" | "reject" | "return" | "close" | "cancel" | "archive" | "restore";

const ARCHIVABLE: CommitmentStatus[] = ["DRAFT", "REJECTED", "CANCELLED", "CLOSED"];

export const commitmentMachine = defineStateMachine<CommitmentStatus, CommitmentTransitionAction>({
  key: "commitment",
  model: "commitment",
  field: "status",
  states: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CLOSED", "CANCELLED", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "submit", from: ["DRAFT", "REJECTED"], to: "PENDING_APPROVAL", permission: "finance.commitment.submit" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: ["finance.approval.decide", "finance.commitment.approve"] },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: ["finance.approval.decide", "finance.commitment.reject"], requiresReason: true },
    { action: "return", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: ["finance.approval.decide", "finance.commitment.reject"], requiresReason: true },
    { action: "close", from: ["APPROVED"], to: "CLOSED", permission: "finance.commitment.close" },
    { action: "cancel", from: ["DRAFT", "REJECTED", "APPROVED"], to: "CANCELLED", permission: "finance.commitment.cancel" },
    { action: "archive", from: ARCHIVABLE, to: "ARCHIVED", permission: "finance.commitment.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ARCHIVABLE, permission: "finance.commitment.restore" },
  ],
});
