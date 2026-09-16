import type { HseHazardStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The hazard register lifecycle (PRD #22 §67, §73; PRD #49 §132).
 *
 * `PENDING_VERIFICATION` is in the enum and nothing writes it: hazards are
 * closed against their closure gaps rather than sent for a second signature,
 * which is what the corrective actions raised from them are for. It is listed
 * as a state so a row stored that way by an older release still reads, and no
 * transition leads into it.
 *
 * Closing is allowed from every live state, including `OPEN` — a hazard that
 * turns out to be nothing is closed with its note, not marched through a
 * control it never needed.
 */
export type HseHazardAction = "start" | "control" | "close" | "reopen" | "cancel";

const LIVE: HseHazardStatus[] = ["OPEN", "CONTROLLED", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"];

export const hseHazardMachine = defineStateMachine<HseHazardStatus, HseHazardAction>({
  key: "hse_hazard",
  model: "hseHazard",
  field: "status",
  states: ["OPEN", "CONTROLLED", "IN_PROGRESS", "PENDING_VERIFICATION", "CLOSED", "CANCELLED", "REOPENED"],
  terminal: ["CANCELLED"],
  transitions: [
    { action: "start", from: ["OPEN"], to: "IN_PROGRESS", permission: "hse.hazard.assign" },
    { action: "control", from: LIVE, to: "CONTROLLED", permission: "hse.hazard.control" },
    { action: "close", from: LIVE, to: "CLOSED", permission: "hse.hazard.close", freezes: "the controls and the residual risk" },
    { action: "reopen", from: ["CLOSED"], to: "REOPENED", permission: "hse.hazard.reopen", requiresReason: true },
    { action: "cancel", from: LIVE, to: "CANCELLED", permission: "hse.hazard.cancel" },
  ],
});
