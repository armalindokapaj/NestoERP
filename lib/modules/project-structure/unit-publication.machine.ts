import type { UnitPublicationStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * A unit's publication lifecycle (E-05D §13, §32; PRD #49 §54; units publish on
 * create, 2026-11).
 *
 * A unit is Published from the moment it is created, and every change to it is
 * published at once as its next version — there is no review, so there is no
 * transition into Published other than restore: creation sets the state, and
 * republishing a Published unit moves only its current version, never its state
 * (`publishLiveUnits`).
 *
 * Archiving is the one way out of use (§32): it keeps the unit's page, files and
 * every published version. Restoring always brings it back Published, publishing
 * its live facts as the next version if they moved while it was archived.
 *
 * Draft, Ready for Publishing and Revision Required belong to the retired review
 * workflow. The 2026-11 migration published every unit held in them, and nothing
 * leads into them any more; archive still accepts them, so a unit left in one by
 * old data can be taken out of use and restored Published.
 */
export type UnitPublicationAction = "archive" | "restore";

export const unitPublicationMachine = defineStateMachine<UnitPublicationStatus, UnitPublicationAction>({
  key: "unit_publication",
  model: "projectUnit",
  field: "publicationStatus",
  states: ["DRAFT", "READY_FOR_PUBLISHING", "PUBLISHED", "REVISION_REQUIRED", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "archive", from: ["DRAFT", "READY_FOR_PUBLISHING", "PUBLISHED", "REVISION_REQUIRED"], to: "ARCHIVED", permission: "project.unit.archive" },
    { action: "restore", from: ["ARCHIVED"], to: "PUBLISHED", permission: "project.unit.archive" },
  ],
});
