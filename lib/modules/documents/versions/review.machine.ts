import type { DocumentReviewStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * One reviewer's decision on one version (PRD #38 §60-§64; PRD #41 §22;
 * PRD #49 §241-§244).
 *
 * A parallel review whose completion rule is ALL: every request is decided on
 * its own, once. A rejection ends the round, so the requests still pending on
 * that version are cancelled by the same decision — `cancel` is never an
 * action anybody takes directly, which is why it carries the decide permission.
 *
 * Reassigning a pending request hands it to somebody else without moving it,
 * and so is not a transition; it is still conditional on the request being
 * pending when it lands.
 *
 * The rules the table cannot express live in the review service: the decider
 * is the named reviewer or somebody that reviewer delegated to, and nobody
 * decides a review they asked for. A rejection's reason is its decision note.
 */
export type DocumentReviewAction = "approve" | "reject" | "cancel";

export const documentReviewMachine = defineStateMachine<DocumentReviewStatus, DocumentReviewAction>({
  key: "document_review",
  model: "documentReview",
  field: "status",
  states: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
  terminal: ["APPROVED", "REJECTED", "CANCELLED"],
  transitions: [
    { action: "approve", from: ["PENDING"], to: "APPROVED", permission: "document.review.decide" },
    { action: "reject", from: ["PENDING"], to: "REJECTED", permission: "document.review.decide", requiresReason: true },
    { action: "cancel", from: ["PENDING"], to: "CANCELLED", permission: "document.review.decide" },
  ],
});
