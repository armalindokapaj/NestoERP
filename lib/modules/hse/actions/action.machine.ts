import type { HseActionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The safety action lifecycle (PRD #22 §122; PRD #49 §132).
 *
 * `REOPENED` is a state of its own rather than a return to `OPEN` (§51, §52):
 * an action that was verified and then reopened is not the same thing as one
 * nobody has finished yet, and the register should be able to tell them apart.
 *
 * Assigning is not on this table. Naming somebody starts an action that had
 * not started, but it is an assignment either way — the service applies the
 * `start` transition when the action was still `OPEN` and writes the assignee
 * without moving it otherwise.
 */
export type HseActionAction =
  | "start"
  | "complete"
  | "verify"
  | "reject"
  | "reopen"
  | "cancel";

export const hseActionMachine = defineStateMachine<HseActionStatus, HseActionAction>({
  key: "hse_action",
  model: "hseAction",
  field: "status",
  states: ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "VERIFIED", "REJECTED", "CANCELLED", "REOPENED"],
  terminal: ["CANCELLED"],
  transitions: [
    { action: "start", from: ["OPEN", "REOPENED", "REJECTED"], to: "IN_PROGRESS", permission: "hse.action.assign" },
    { action: "complete", from: ["OPEN", "IN_PROGRESS", "REOPENED", "REJECTED"], to: "PENDING_VERIFICATION", permission: "hse.action.complete" },
    { action: "verify", from: ["PENDING_VERIFICATION"], to: "VERIFIED", permission: "hse.action.verify", freezes: "the completion note and its evidence" },
    { action: "reject", from: ["PENDING_VERIFICATION"], to: "REJECTED", permission: "hse.action.verify" },
    { action: "reopen", from: ["VERIFIED"], to: "REOPENED", permission: "hse.action.reopen", requiresReason: true },
    { action: "cancel", from: ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "REJECTED", "REOPENED"], to: "CANCELLED", permission: "hse.action.cancel" },
  ],
});
