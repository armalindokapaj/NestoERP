import type { QualityInspectionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The quality inspection lifecycle (PRD #21 §72, §82, §88; PRD #49 §131).
 *
 * `rework` and `reopen` both lead backwards, and they are not the same thing.
 * Rework follows a rejection and is the ordinary path — the inspection is
 * walked again, and the rejection stays on the record. Reopening a *closed*
 * inspection only undoes the closure, returning it to `APPROVED`: the verdict
 * somebody signed is not reopened with it, and the answer to "it needs looking
 * at again" is a reinspection with its own verdict.
 */
export type QualityInspectionAction =
  | "start"
  | "submit"
  | "approve"
  | "reject"
  | "rework"
  | "close"
  | "reopen"
  | "cancel";

export const qualityInspectionMachine = defineStateMachine<QualityInspectionStatus, QualityInspectionAction>({
  key: "quality_inspection",
  model: "qualityInspection",
  field: "status",
  states: ["DRAFT", "IN_PROGRESS", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CLOSED", "CANCELLED"],
  terminal: ["CANCELLED"],
  transitions: [
    { action: "start", from: ["DRAFT"], to: "IN_PROGRESS", permission: "qaqc.inspection.execute" },
    { action: "submit", from: ["IN_PROGRESS"], to: "PENDING_APPROVAL", permission: "qaqc.inspection.submit", freezes: "the checklist answers and the verdict" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: "qaqc.inspection.approve" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: "qaqc.inspection.reject" },
    { action: "rework", from: ["REJECTED"], to: "IN_PROGRESS", permission: "qaqc.inspection.execute" },
    { action: "close", from: ["APPROVED"], to: "CLOSED", permission: "qaqc.inspection.close", freezes: "the whole inspection" },
    { action: "reopen", from: ["CLOSED"], to: "APPROVED", permission: "qaqc.inspection.reopen" },
    { action: "cancel", from: ["DRAFT", "IN_PROGRESS"], to: "CANCELLED", permission: "qaqc.inspection.cancel" },
  ],
});
