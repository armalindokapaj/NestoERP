import { hseInspectionMachine } from "@/lib/modules/hse/inspections/inspection.machine";
import { hseActionMachine } from "@/lib/modules/hse/actions/action.machine";
import { hseHazardMachine } from "@/lib/modules/hse/hazards/hazard.machine";
import { hseIncidentMachine } from "@/lib/modules/hse/incidents/incident.machine";
import { hsePermitMachine } from "@/lib/modules/hse/permits/permit.machine";
import { correctiveActionMachine } from "@/lib/modules/qaqc/corrective-actions/action.machine";
import { qualityInspectionMachine } from "@/lib/modules/qaqc/inspections/inspection.machine";
import type { StateMachine } from "./machine";

/**
 * Every declared state machine, in one place (PRD #49 §154-§156).
 *
 * This is an aggregation point in the sense PRD #48 gave the word: it imports
 * every domain that declares a machine, and the dependency gate cuts it for
 * that reason. It exists so three things can be derived rather than
 * maintained by hand — the documentation in `docs/state-machines.md`, the
 * gate that checks a machine only governs a model its own domain owns, and
 * the transition matrix the tests walk.
 *
 * A machine is registered here or it does not exist: `applyTransition` reaches
 * its model through a delegate name, which is invisible to the ownership
 * scanner, so this list is what puts those writes back under the same rule as
 * every other write.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- machines differ in their state and action unions by design; the registry only reads the common fields.
export const STATE_MACHINES: ReadonlyArray<StateMachine<any, any>> = [
  hseInspectionMachine,
  hsePermitMachine,
  hseActionMachine,
  hseIncidentMachine,
  hseHazardMachine,
  qualityInspectionMachine,
  correctiveActionMachine,
];

