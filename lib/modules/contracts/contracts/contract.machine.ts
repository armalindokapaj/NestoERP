import type { ContractStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The contract lifecycle (PRD #18 §40, §191, §293; PRD #49 §130).
 *
 * Several things here are deliberate and easy to get wrong when reading the
 * enum alone:
 *
 *   a rejected approval sends the contract back to `IN_REVIEW`, not to draft —
 *   the reviewer's work is not undone by a rejection (§114). Returning it for
 *   revision is the approver's other answer, and that one does go to `DRAFT`.
 *   Neither is reachable through "return to draft" or "send for review", which
 *   start only from review and draft: moving a contract off `PENDING_APPROVAL`
 *   without deciding its cycle would leave the cycle pending on a record no
 *   longer waiting for it (PRD #47 §85);
 *
 *   `ACTIVE` is never cancelled. A contract in force is terminated, and so is a
 *   signed one that has not yet taken effect (§128);
 *
 *   `EXPIRED` is written, but only by the permissioned "expire" action, which
 *   refuses while the expiry date is still ahead. No job writes it. Every
 *   report and list reads the date instead, so a lapsed contract shows as
 *   expired whether or not anybody has recorded it (§123, §193);
 *
 *   `COMPLETED` is an active contract whose obligations are fulfilled — for a
 *   unit sale, financially complete, which the service checks above the write
 *   (E-05F §83). It is finished, so it may be archived;
 *
 *   nothing is terminal. The archive is left by a restore, which returns the
 *   status the contract held before it was archived — so its destinations are
 *   exactly the states archiving is allowed from.
 *
 * Approving, rejecting and returning need `legal.approval.decide` as well as
 * the permission named here. The service asserts both; the table can only say
 * "any one of", so it names the one that is specific to contracts.
 * Past `APPROVED` a material change is an amendment, never an edit (§106).
 */
export type ContractAction =
  | "submit_review"
  | "return_to_draft"
  | "submit_approval"
  | "approve"
  | "reject"
  | "return_for_revision"
  | "mark_sent"
  | "mark_signed"
  | "activate"
  | "complete"
  | "expire"
  | "terminate"
  | "cancel"
  | "archive"
  | "restore";

/** Finished, or never started: what may be archived, and so what a restore may return to (§134, §135). */
const ARCHIVABLE: ContractStatus[] = ["DRAFT", "COMPLETED", "EXPIRED", "TERMINATED", "CANCELLED"];

export const contractMachine = defineStateMachine<ContractStatus, ContractAction>({
  key: "contract",
  model: "contract",
  field: "status",
  states: ["DRAFT", "IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "SENT", "SIGNED", "ACTIVE", "COMPLETED", "EXPIRED", "TERMINATED", "CANCELLED", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "submit_review", from: ["DRAFT"], to: "IN_REVIEW", permission: "legal.contract.submit_review" },
    { action: "return_to_draft", from: ["IN_REVIEW"], to: "DRAFT", permission: "legal.contract.review" },
    { action: "submit_approval", from: ["IN_REVIEW"], to: "PENDING_APPROVAL", permission: "legal.contract.submit_approval" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: "legal.contract.approve", freezes: "the value, dates, parties and legal terms" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "IN_REVIEW", permission: "legal.contract.reject", requiresReason: true },
    { action: "return_for_revision", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: "legal.contract.reject", requiresReason: true },
    { action: "mark_sent", from: ["APPROVED"], to: "SENT", permission: "legal.contract.mark_sent" },
    { action: "mark_signed", from: ["SENT"], to: "SIGNED", permission: "legal.contract.mark_signed" },
    { action: "activate", from: ["SIGNED"], to: "ACTIVE", permission: "legal.contract.activate" },
    { action: "complete", from: ["ACTIVE"], to: "COMPLETED", permission: "legal.contract.complete", freezes: "the contract, its units and its schedule" },
    { action: "expire", from: ["ACTIVE"], to: "EXPIRED", permission: "legal.contract.expire" },
    { action: "terminate", from: ["SIGNED", "ACTIVE"], to: "TERMINATED", permission: "legal.contract.terminate", requiresReason: true },
    { action: "cancel", from: ["DRAFT", "IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "SENT"], to: "CANCELLED", permission: "legal.contract.cancel" },
    { action: "archive", from: ARCHIVABLE, to: "ARCHIVED", permission: "legal.contract.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ARCHIVABLE, permission: "legal.contract.restore" },
  ],
});
