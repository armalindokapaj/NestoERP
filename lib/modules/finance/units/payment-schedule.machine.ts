import type { PaymentScheduleStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * A sale contract's payment schedule (E-05F §20, §25, §76, §82-§84).
 *
 * A draft is edited as a whole and activated once its total is right; a later
 * change is a new version, and activating it supersedes the one in force in the
 * same transaction — the old schedule keeps its installments and whatever was
 * paid against them. A draft nobody wants is cancelled, never deleted.
 *
 * The contract drives the rest. Cancelling or terminating the contract cancels
 * its schedules, and Legal holds that grant as much as Finance does (§82);
 * completing the contract completes its schedule.
 */
export type PaymentScheduleAction = "activate" | "supersede" | "discard" | "cancel_with_contract" | "complete_with_contract";

export const paymentScheduleMachine = defineStateMachine<PaymentScheduleStatus, PaymentScheduleAction>({
  key: "payment_schedule",
  model: "paymentSchedule",
  field: "status",
  states: ["DRAFT", "ACTIVE", "SUPERSEDED", "COMPLETED", "CANCELLED"],
  terminal: ["SUPERSEDED", "COMPLETED", "CANCELLED"],
  transitions: [
    { action: "activate", from: ["DRAFT"], to: "ACTIVE", permission: "project.unit.finance.manage_schedule", freezes: "its installments, amounts and due dates" },
    { action: "supersede", from: ["ACTIVE"], to: "SUPERSEDED", permission: "project.unit.finance.manage_schedule" },
    { action: "discard", from: ["DRAFT"], to: "CANCELLED", permission: "project.unit.finance.manage_schedule" },
    { action: "cancel_with_contract", from: ["DRAFT", "ACTIVE"], to: "CANCELLED", permission: ["project.unit.contract.cancel", "project.unit.finance.correct"], requiresReason: true },
    { action: "complete_with_contract", from: ["ACTIVE"], to: "COMPLETED", permission: ["project.unit.contract.sign_status", "project.unit.finance.manage_schedule"] },
  ],
});
