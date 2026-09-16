import type { EngineeringRevisionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * An engineering document revision's lifecycle (PRD #46 §66-§75; PRD #49
 * §139-§141).
 *
 *   DRAFT → SUBMITTED → UNDER_REVIEW → FINALIZED → SUPERSEDED
 *
 * Submitting pins the exact file version and freezes it: a correction is the
 * next revision, never a new version of this one's file (§140). A review may
 * be decided straight from `SUBMITTED` — starting it first tells the submitter
 * somebody has it, and the decision does not wait for that.
 *
 * The decision is not a state of its own (§139). `reviewDecision` is written
 * once, in the same guarded write that finalises the revision, and nothing
 * leads out of `FINALIZED` except being superseded — so the status guard is
 * what stops a second decision overwriting the first.
 *
 * Nobody asks for `supersede`. Approving a revision supersedes every older one
 * still standing, which stays readable with its decision (§141); only an
 * approving decision does that, so it carries the approve grant. The service
 * supersedes an older revision still marked submitted or under review along
 * with the finalised ones, although with one revision in progress at a time
 * only an inconsistent row could be. `void` discards a draft, by itself or
 * because its document was retired — both of which hold the edit grant.
 *
 * A submittal's revisions follow the same table under their own grants, in
 * engineering.submittal-revision.machine.ts; one engine drives both.
 */
export type EngineeringRevisionAction = "submit" | "start_review" | "decide" | "supersede" | "void";

export const engineeringRevisionMachine = defineStateMachine<EngineeringRevisionStatus, EngineeringRevisionAction>({
  key: "engineering_revision",
  model: "engineeringDocumentRevision",
  field: "status",
  states: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "FINALIZED", "SUPERSEDED", "VOID"],
  terminal: ["SUPERSEDED", "VOID"],
  transitions: [
    { action: "submit", from: ["DRAFT"], to: "SUBMITTED", permission: "engineering_document.submit", freezes: "the file, at the exact version submitted" },
    { action: "start_review", from: ["SUBMITTED"], to: "UNDER_REVIEW", permission: "engineering_document.review" },
    { action: "decide", from: ["SUBMITTED", "UNDER_REVIEW"], to: "FINALIZED", permission: "engineering_document.review", freezes: "the decision and the reviewer's comment" },
    { action: "supersede", from: ["SUBMITTED", "UNDER_REVIEW", "FINALIZED"], to: "SUPERSEDED", permission: "engineering_document.approve" },
    { action: "void", from: ["DRAFT"], to: "VOID", permission: "engineering_document.edit" },
  ],
});
