import type { ContractObligationStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The obligation lifecycle (PRD #18 §152, §156, §157, §295).
 *
 * Open, then completed or cancelled, and that is the whole of it: neither
 * closure is undone. Overdue is not a state — it is an open obligation whose
 * due date has passed, a fact about today rather than something stored (§152).
 *
 * Terminating or expiring the contract leaves its obligations as they are;
 * nothing outside the two actions here moves one.
 */
export type ContractObligationAction = "complete" | "cancel";

export const contractObligationMachine = defineStateMachine<ContractObligationStatus, ContractObligationAction>({
  key: "contract_obligation",
  model: "contractObligation",
  field: "status",
  states: ["OPEN", "COMPLETED", "CANCELLED"],
  terminal: ["COMPLETED", "CANCELLED"],
  transitions: [
    { action: "complete", from: ["OPEN"], to: "COMPLETED", permission: "legal.obligation.complete", freezes: "the whole obligation" },
    { action: "cancel", from: ["OPEN"], to: "CANCELLED", permission: "legal.obligation.cancel", freezes: "the whole obligation" },
  ],
});
