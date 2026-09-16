import type { HseInspectionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The safety inspection lifecycle (PRD #22 §41, §50, §52, §56; PRD #49 §132).
 *
 * The predicates in `hse.status.ts` say which states an action is offered
 * from; this table says the same thing in the one form the transition itself
 * can read, so the offer and the write cannot disagree. `REJECTED` leads back
 * to `IN_PROGRESS` rather than to a fresh draft: a rejected inspection is
 * re-walked, and its earlier answers stay attached to it (§4, §207).
 */
export type HseInspectionAction =
  | "start"
  | "submit"
  | "approve"
  | "reject"
  | "close"
  | "cancel";

export const hseInspectionMachine = defineStateMachine<HseInspectionStatus, HseInspectionAction>({
  key: "hse_inspection",
  model: "hseInspection",
  field: "status",
  states: ["DRAFT", "SCHEDULED", "IN_PROGRESS", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CLOSED", "CANCELLED"],
  terminal: ["CLOSED", "CANCELLED"],
  transitions: [
    { action: "start", from: ["DRAFT", "SCHEDULED", "REJECTED"], to: "IN_PROGRESS", permission: "hse.inspection.execute" },
    { action: "submit", from: ["IN_PROGRESS"], to: "PENDING_APPROVAL", permission: "hse.inspection.submit", freezes: "the checklist answers and the overall result" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: "hse.inspection.approve" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: "hse.inspection.reject" },
    { action: "close", from: ["APPROVED"], to: "CLOSED", permission: "hse.inspection.close", freezes: "the whole inspection" },
    { action: "cancel", from: ["DRAFT", "SCHEDULED", "IN_PROGRESS"], to: "CANCELLED", permission: "hse.inspection.cancel" },
  ],
});
