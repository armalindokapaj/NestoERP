import type { UnitPublicationStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * A unit's publication lifecycle (E-05D §13, §14, §21-§32; PRD #49 §54).
 *
 * `submit` asks for review and `publish` approves — separate grants, because the
 * people who prepare a unit are not thereby the people who approve it for Sales
 * (§89). A publisher may publish a unit they are looking at without waiting for
 * a request; the readiness check runs either way (§17).
 *
 * `publish` is also legal from Published: republishing a unit whose live data
 * has moved on creates the next version and keeps the unit Published throughout
 * (§25, §27). `request_revision` asks for a correction with a reason (§22) — from
 * a request waiting for review, or from a published unit that has to come out of
 * use. `unpublish` takes a published unit back to Ready for Publishing (§31).
 *
 * Archiving takes the unit out of every normal workflow and keeps its history
 * (§32). Restoring returns it to what it held before; a unit archived while
 * waiting for review comes back as a Draft, since its request was cancelled.
 */
export type UnitPublicationAction = "submit" | "publish" | "request_revision" | "unpublish" | "archive" | "restore";

export const unitPublicationMachine = defineStateMachine<UnitPublicationStatus, UnitPublicationAction>({
  key: "unit_publication",
  model: "projectUnit",
  field: "publicationStatus",
  states: ["DRAFT", "READY_FOR_PUBLISHING", "PUBLISHED", "REVISION_REQUIRED", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "submit", from: ["DRAFT", "REVISION_REQUIRED"], to: "READY_FOR_PUBLISHING", permission: "project.unit.submit_for_publish" },
    {
      action: "publish",
      from: ["DRAFT", "READY_FOR_PUBLISHING", "REVISION_REQUIRED", "PUBLISHED"],
      to: "PUBLISHED",
      permission: "project.unit.publish",
      freezes: "the published version: its snapshot, Sales Plan version and primary image",
    },
    { action: "request_revision", from: ["READY_FOR_PUBLISHING", "PUBLISHED"], to: "REVISION_REQUIRED", permission: "project.unit.revision_request", requiresReason: true },
    { action: "unpublish", from: ["PUBLISHED"], to: "READY_FOR_PUBLISHING", permission: "project.unit.unpublish", requiresReason: true },
    { action: "archive", from: ["DRAFT", "READY_FOR_PUBLISHING", "PUBLISHED", "REVISION_REQUIRED"], to: "ARCHIVED", permission: "project.unit.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ["DRAFT", "PUBLISHED", "REVISION_REQUIRED"], permission: "project.unit.archive" },
  ],
});
