import type { EngineeringDocumentStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The engineering document register lifecycle (PRD #46 §59-§81; PRD #49 §137,
 * §138).
 *
 * Nobody moves a document's status by hand: it follows the review of its
 * current revision. Submitting a revision submits the document, starting that
 * review puts it under review, and the decision recorded on the revision
 * becomes the document's status — each applied in engineering.revisions.ts as
 * the second half of the revision's own move, so each declares the grant that
 * move needs. Approving takes the approve grant; the review grant the service
 * checks first is not enough on its own.
 *
 * A reviewed document takes its next revision from wherever the review left
 * it: a new technical change is a new revision, never an edit to the approved
 * one (§138). Nothing is submitted from `SUBMITTED` or `UNDER_REVIEW` because
 * only one revision is in progress at a time — a rule the table cannot express,
 * held by `createRevision`.
 *
 * Voiding and superseding retire the whole document, with a reason. Voiding
 * can interrupt a review; superseding waits for it, which the service checks
 * against the revisions (`ENGINEERING_DOCUMENT_IN_REVIEW`) and which is why
 * `supersede` is not declared from the review states.
 */
export type EngineeringDocumentAction = "submit" | "start_review" | "approve" | "approve_with_comments" | "require_revision" | "reject" | "void" | "supersede";

const IN_REVIEW: EngineeringDocumentStatus[] = ["SUBMITTED", "UNDER_REVIEW"];
const REVIEWED: EngineeringDocumentStatus[] = ["APPROVED", "APPROVED_WITH_COMMENTS", "REVISION_REQUIRED", "REJECTED"];

export const engineeringDocumentMachine = defineStateMachine<EngineeringDocumentStatus, EngineeringDocumentAction>({
  key: "engineering_document",
  model: "engineeringDocument",
  field: "status",
  states: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "APPROVED_WITH_COMMENTS", "REVISION_REQUIRED", "REJECTED", "SUPERSEDED", "VOID"],
  terminal: ["SUPERSEDED", "VOID"],
  transitions: [
    { action: "submit", from: ["DRAFT", ...REVIEWED], to: "SUBMITTED", permission: "engineering_document.submit", freezes: "the title and type, while the reviewer has them" },
    { action: "start_review", from: ["SUBMITTED"], to: "UNDER_REVIEW", permission: "engineering_document.review" },
    { action: "approve", from: IN_REVIEW, to: "APPROVED", permission: "engineering_document.approve", freezes: "the title and type that were approved" },
    { action: "approve_with_comments", from: IN_REVIEW, to: "APPROVED_WITH_COMMENTS", permission: "engineering_document.approve", freezes: "the title and type that were approved" },
    { action: "require_revision", from: IN_REVIEW, to: "REVISION_REQUIRED", permission: "engineering_document.review" },
    { action: "reject", from: IN_REVIEW, to: "REJECTED", permission: "engineering_document.review" },
    { action: "void", from: ["DRAFT", ...IN_REVIEW, ...REVIEWED], to: "VOID", permission: "engineering_document.approve", requiresReason: true, freezes: "the whole document" },
    { action: "supersede", from: ["DRAFT", ...REVIEWED], to: "SUPERSEDED", permission: "engineering_document.approve", requiresReason: true, freezes: "the whole document" },
  ],
});
