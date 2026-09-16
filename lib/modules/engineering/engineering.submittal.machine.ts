import type { TechnicalSubmittalStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The technical submittal lifecycle (PRD #46 §98-§117, §227; PRD #49 §146-§148).
 *
 * Like an engineering document, a submittal's status follows the review of
 * its current revision: submitting, starting the review and deciding it are
 * applied from engineering.revisions.ts alongside the revision's own move, and
 * approving takes the approve grant on top of the review grant.
 *
 * Submitting freezes what the reviewer is looking at — the product, its make
 * and model, the specification clause, the supplier and the kind of
 * submittal — and a decision keeps it frozen, except "revision required",
 * after which the next revision may change it (§148). The freeze itself lives
 * in the service (`SUBMITTAL_DETAILS_FROZEN`).
 *
 * A decided submittal is closed out by the people who decide them; "revision
 * required" is not a final decision, so it is not closed. Voiding needs a
 * reason and may interrupt a review.
 */
export type TechnicalSubmittalAction = "submit" | "start_review" | "approve" | "approve_with_comments" | "require_revision" | "reject" | "close" | "void";

const IN_REVIEW: TechnicalSubmittalStatus[] = ["SUBMITTED", "UNDER_REVIEW"];
const REVIEWED: TechnicalSubmittalStatus[] = ["APPROVED", "APPROVED_WITH_COMMENTS", "REVISION_REQUIRED", "REJECTED"];
const PRODUCT_DETAILS = "the product details under review";

export const technicalSubmittalMachine = defineStateMachine<TechnicalSubmittalStatus, TechnicalSubmittalAction>({
  key: "technical_submittal",
  model: "technicalSubmittal",
  field: "status",
  states: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "APPROVED_WITH_COMMENTS", "REVISION_REQUIRED", "REJECTED", "CLOSED", "VOID"],
  terminal: ["CLOSED", "VOID"],
  transitions: [
    { action: "submit", from: ["DRAFT", ...REVIEWED], to: "SUBMITTED", permission: "submittal.submit", freezes: PRODUCT_DETAILS },
    { action: "start_review", from: ["SUBMITTED"], to: "UNDER_REVIEW", permission: "submittal.review" },
    { action: "approve", from: IN_REVIEW, to: "APPROVED", permission: "submittal.approve", freezes: PRODUCT_DETAILS },
    { action: "approve_with_comments", from: IN_REVIEW, to: "APPROVED_WITH_COMMENTS", permission: "submittal.approve", freezes: PRODUCT_DETAILS },
    { action: "require_revision", from: IN_REVIEW, to: "REVISION_REQUIRED", permission: "submittal.review" },
    { action: "reject", from: IN_REVIEW, to: "REJECTED", permission: "submittal.review", freezes: PRODUCT_DETAILS },
    { action: "close", from: ["APPROVED", "APPROVED_WITH_COMMENTS", "REJECTED"], to: "CLOSED", permission: "submittal.approve", freezes: "the whole submittal" },
    { action: "void", from: ["DRAFT", ...IN_REVIEW, ...REVIEWED], to: "VOID", permission: "submittal.approve", requiresReason: true, freezes: "the whole submittal" },
  ],
});
