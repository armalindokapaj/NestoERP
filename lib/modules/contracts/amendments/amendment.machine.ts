import type { ContractAmendmentStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The amendment lifecycle (PRD #18 §162, §170–§180, §294; PRD #49 §130).
 *
 * A material change to an approved contract is an amendment, never an
 * overwrite. The amendment runs its own approval and signing cycle, and
 * activating it is the one moment it touches the contract: under a lock on the
 * contract row it copies the value and expiry the contract held onto itself,
 * then writes its new value and expiry — whichever it carries — onto the
 * contract. The contract's own status does not move, and activation is refused
 * once the contract has been terminated, expired, cancelled or archived.
 *
 * A rejected amendment waits in `REJECTED` to be corrected and resubmitted; one
 * returned for revision goes back to `DRAFT`. Both are editable again, and a
 * resubmission opens a new approval cycle with the old one kept (PRD #41 §48).
 *
 * `ACTIVE` and `ARCHIVED` are terminal. An executed amendment is history, and
 * changing the terms again means writing another one (§179); an archived
 * amendment has no restore.
 *
 * Approving, rejecting and returning need `legal.approval.decide` as well as
 * the permission named here, as for contracts. Every move also refuses while
 * the contract is archived, which the table cannot say.
 */
export type ContractAmendmentAction =
  | "submit"
  | "approve"
  | "reject"
  | "return_for_revision"
  | "mark_sent"
  | "mark_signed"
  | "activate"
  | "cancel"
  | "archive";

export const contractAmendmentMachine = defineStateMachine<ContractAmendmentStatus, ContractAmendmentAction>({
  key: "contract_amendment",
  model: "contractAmendment",
  field: "status",
  states: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT", "SIGNED", "ACTIVE", "CANCELLED", "ARCHIVED"],
  terminal: ["ACTIVE", "ARCHIVED"],
  transitions: [
    { action: "submit", from: ["DRAFT", "REJECTED"], to: "PENDING_APPROVAL", permission: "legal.amendment.submit", freezes: "the amendment's terms" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: "legal.amendment.approve" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: "legal.amendment.reject", requiresReason: true },
    { action: "return_for_revision", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: "legal.amendment.reject", requiresReason: true },
    { action: "mark_sent", from: ["APPROVED"], to: "SENT", permission: "legal.amendment.mark_sent" },
    { action: "mark_signed", from: ["SENT"], to: "SIGNED", permission: "legal.amendment.mark_signed" },
    { action: "activate", from: ["SIGNED"], to: "ACTIVE", permission: "legal.amendment.activate", freezes: "the whole amendment, and the contract values it replaced" },
    { action: "cancel", from: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT", "SIGNED"], to: "CANCELLED", permission: "legal.amendment.cancel" },
    { action: "archive", from: ["DRAFT", "REJECTED", "CANCELLED"], to: "ARCHIVED", permission: "legal.amendment.archive" },
  ],
});
