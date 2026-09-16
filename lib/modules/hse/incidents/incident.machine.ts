import type { HseIncidentStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The incident lifecycle (PRD #22 §95; PRD #49 §132).
 *
 * Closing goes through an approval, so `PENDING_CLOSE` is a real state and not
 * a flag: the incident sits there while somebody else decides. That decision
 * has no rejection — the HSE provider sets `canReject: () => false`, so a
 * closure that should not go ahead is cancelled or reopened, never bounced.
 *
 * `ACTIONS_OPEN` is reached by the corrective actions raised against the
 * incident, not by anything on this table — it is set where those actions are
 * counted, and closing is allowed from it because actions can outlive the
 * investigation that raised them.
 */
export type HseIncidentAction =
  | "investigate"
  | "submit_close"
  | "close"
  | "reopen"
  | "cancel";

export const hseIncidentMachine = defineStateMachine<HseIncidentStatus, HseIncidentAction>({
  key: "hse_incident",
  model: "hseIncident",
  field: "status",
  states: ["OPEN", "UNDER_INVESTIGATION", "ACTIONS_OPEN", "PENDING_CLOSE", "CLOSED", "CANCELLED", "REOPENED"],
  terminal: ["CANCELLED"],
  transitions: [
    { action: "investigate", from: ["OPEN", "REOPENED", "UNDER_INVESTIGATION"], to: "UNDER_INVESTIGATION", permission: "hse.incident.investigate" },
    { action: "submit_close", from: ["UNDER_INVESTIGATION", "ACTIONS_OPEN"], to: "PENDING_CLOSE", permission: "hse.incident.submit_close" },
    { action: "close", from: ["PENDING_CLOSE"], to: "CLOSED", permission: "hse.incident.close", freezes: "the investigation, its root cause and its lessons" },
    { action: "reopen", from: ["CLOSED"], to: "REOPENED", permission: "hse.incident.reopen", requiresReason: true },
    { action: "cancel", from: ["OPEN", "UNDER_INVESTIGATION", "ACTIONS_OPEN", "PENDING_CLOSE", "REOPENED"], to: "CANCELLED", permission: "hse.incident.cancel" },
  ],
});
