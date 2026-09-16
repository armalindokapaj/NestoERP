import type { SubmittalRevisionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * A technical submittal revision's lifecycle (PRD #46 §102-§105; PRD #49 §147,
 * §148).
 *
 *   DRAFT → SUBMITTED → UNDER_REVIEW → FINALIZED → SUPERSEDED
 *
 * The same lifecycle as a document revision, driven by the same engine in
 * engineering.revisions.ts — see engineering.revision.machine.ts for why a
 * decision is not a state and who supersedes. It is a machine of its own
 * because the table and the grants are the submittal's: a submitted revision
 * is immutable (§147), and a changed product after "revision required" is the
 * next revision (§148).
 */
export type SubmittalRevisionAction = "submit" | "start_review" | "decide" | "supersede" | "void";

export const submittalRevisionMachine = defineStateMachine<SubmittalRevisionStatus, SubmittalRevisionAction>({
  key: "submittal_revision",
  model: "technicalSubmittalRevision",
  field: "status",
  states: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "FINALIZED", "SUPERSEDED", "VOID"],
  terminal: ["SUPERSEDED", "VOID"],
  transitions: [
    { action: "submit", from: ["DRAFT"], to: "SUBMITTED", permission: "submittal.submit", freezes: "the file, at the exact version submitted" },
    { action: "start_review", from: ["SUBMITTED"], to: "UNDER_REVIEW", permission: "submittal.review" },
    { action: "decide", from: ["SUBMITTED", "UNDER_REVIEW"], to: "FINALIZED", permission: "submittal.review", freezes: "the decision and the reviewer's comment" },
    { action: "supersede", from: ["SUBMITTED", "UNDER_REVIEW", "FINALIZED"], to: "SUPERSEDED", permission: "submittal.approve" },
    { action: "void", from: ["DRAFT"], to: "VOID", permission: "submittal.edit" },
  ],
});
