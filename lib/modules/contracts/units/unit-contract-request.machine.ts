import type { UnitContractRequestStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * Sales asking Legal for a unit's contract (E-05F §12).
 *
 * A request waits in Legal's queue until Legal drafts the contract from it, or
 * declines it with a reason. A request whose reservation has ended is no longer
 * a request for anything: Sales withdraws it, or Legal's queue closes it as
 * cancelled the next time it is read, and a new reservation needs a new request.
 */
export type UnitContractRequestAction = "fulfil" | "decline" | "cancel";

export const unitContractRequestMachine = defineStateMachine<UnitContractRequestStatus, UnitContractRequestAction>({
  key: "unit_contract_request",
  model: "unitContractRequest",
  field: "status",
  states: ["OPEN", "FULFILLED", "DECLINED", "CANCELLED"],
  terminal: ["FULFILLED", "DECLINED", "CANCELLED"],
  transitions: [
    { action: "fulfil", from: ["OPEN"], to: "FULFILLED", permission: "project.unit.contract.create" },
    { action: "decline", from: ["OPEN"], to: "DECLINED", permission: "project.unit.contract.review", requiresReason: true },
    { action: "cancel", from: ["OPEN"], to: "CANCELLED", permission: ["project.unit.contract.request", "project.unit.contract.review"] },
  ],
});
