import type { CorrectiveActionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The corrective action lifecycle (PRD #21 §147; PRD #49 §131).
 *
 * The same shape as the HSE action register, and deliberately so: whoever did
 * the work says it is done, somebody else says it is actually done. `REJECTED`
 * returns the action to the person who completed it rather than closing it,
 * and `REOPENED` is kept apart from `OPEN` so a reopened action is legible as
 * one that was signed off and then was not.
 */
export type CorrectiveActionAction = "start" | "complete" | "verify" | "reject" | "reopen" | "cancel";

export const correctiveActionMachine = defineStateMachine<CorrectiveActionStatus, CorrectiveActionAction>({
  key: "corrective_action",
  model: "correctiveAction",
  field: "status",
  states: ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "VERIFIED", "REJECTED", "CANCELLED", "REOPENED"],
  terminal: ["CANCELLED"],
  transitions: [
    { action: "start", from: ["OPEN"], to: "IN_PROGRESS", permission: "qaqc.corrective_action.assign" },
    { action: "complete", from: ["OPEN", "IN_PROGRESS", "REJECTED", "REOPENED"], to: "PENDING_VERIFICATION", permission: "qaqc.corrective_action.complete" },
    { action: "verify", from: ["PENDING_VERIFICATION"], to: "VERIFIED", permission: "qaqc.corrective_action.verify", freezes: "the completion note and its evidence" },
    { action: "reject", from: ["PENDING_VERIFICATION"], to: "REJECTED", permission: "qaqc.corrective_action.verify", requiresReason: true },
    { action: "reopen", from: ["VERIFIED"], to: "REOPENED", permission: "qaqc.corrective_action.reopen", requiresReason: true },
    { action: "cancel", from: ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "REJECTED", "REOPENED"], to: "CANCELLED", permission: "qaqc.corrective_action.cancel" },
  ],
});
