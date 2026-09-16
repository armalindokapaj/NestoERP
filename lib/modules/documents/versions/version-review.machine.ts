import type { DocumentReviewState } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * Where one version of a document stands in review (PRD #38 §59, §65;
 * PRD #49 §241-§248).
 *
 * The version follows its reviews rather than being moved by anybody directly:
 * asking a reviewer puts it in review, the last approval approves it, the first
 * rejection rejects it. Asking again from `IN_REVIEW` adds a reviewer to the
 * round already open; asking again from `REJECTED` opens a new one. An approved
 * or superseded version is not sent round again — a correction is a new
 * version.
 *
 * `SUPERSEDED` is reached only as a side effect of approving a later version,
 * and is never deleted: the file, its reviews and its decisions all stay.
 * Approving an older version after a newer one leaves both approved, because
 * only versions numbered below the one approved are superseded.
 *
 * Two rules the table cannot express, both held by the review service: nobody
 * decides a review they asked for, and "the last approval" is counted under a
 * lock on the version row, so two reviewers approving at once cannot each see
 * the other still pending and leave the version in review forever (§244).
 */
export type DocumentVersionReviewAction = "request" | "approve" | "reject" | "supersede";

export const documentVersionReviewMachine = defineStateMachine<DocumentReviewState, DocumentVersionReviewAction>({
  key: "document_version_review",
  model: "documentVersion",
  field: "reviewState",
  states: ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"],
  terminal: ["SUPERSEDED"],
  transitions: [
    { action: "request", from: ["DRAFT", "IN_REVIEW", "REJECTED"], to: "IN_REVIEW", permission: "document.review.request" },
    { action: "approve", from: ["IN_REVIEW"], to: "APPROVED", permission: "document.review.decide", freezes: "its review: an approved version is not sent round again" },
    { action: "reject", from: ["IN_REVIEW"], to: "REJECTED", permission: "document.review.decide" },
    // Applied by whoever approves the later version, which is why it carries
    // the decide permission rather than one of its own.
    { action: "supersede", from: ["APPROVED"], to: "SUPERSEDED", permission: "document.review.decide" },
  ],
});
