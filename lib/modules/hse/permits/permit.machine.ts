import type { HsePermitStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The permit-to-work lifecycle (PRD #22 §150, §153, §351; PRD #49 §132).
 *
 * Two things here are deliberate and easy to get wrong when reading the enum
 * alone:
 *
 *   a rejected permit goes back to `DRAFT`, not to a `REJECTED` state — the
 *   crew corrects it and submits again, and the decision itself is kept by the
 *   approval record rather than by the permit's own column (§117);
 *
 *   `EXPIRED` is derived from the permit's window, never written (§201). It
 *   stays in the state list because a permit stored as `EXPIRED` by an older
 *   release must still be closable, but nothing in the service moves a permit
 *   into it.
 */
export type HsePermitAction =
  | "submit"
  | "approve"
  | "reject"
  | "activate"
  | "suspend"
  | "close"
  | "cancel";

export const hsePermitMachine = defineStateMachine<HsePermitStatus, HsePermitAction>({
  key: "hse_permit",
  model: "hseWorkPermit",
  field: "status",
  states: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ACTIVE", "SUSPENDED", "EXPIRED", "CLOSED", "CANCELLED"],
  terminal: ["CLOSED", "CANCELLED"],
  transitions: [
    { action: "submit", from: ["DRAFT"], to: "PENDING_APPROVAL", permission: "hse.permit.submit" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: "hse.permit.approve", freezes: "the work described and its window" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: "hse.permit.approve" },
    { action: "activate", from: ["APPROVED", "SUSPENDED"], to: "ACTIVE", permission: "hse.permit.activate" },
    { action: "suspend", from: ["ACTIVE"], to: "SUSPENDED", permission: "hse.permit.suspend", requiresReason: true },
    { action: "close", from: ["ACTIVE", "SUSPENDED", "EXPIRED"], to: "CLOSED", permission: "hse.permit.close", freezes: "the whole permit" },
    { action: "cancel", from: ["DRAFT", "PENDING_APPROVAL", "APPROVED"], to: "CANCELLED", permission: "hse.permit.cancel" },
  ],
});
