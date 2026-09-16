import type { DocumentStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * A document's business visibility (PRD #13 §112-§115; PRD #29 §135, §137;
 * PRD #49 §132).
 *
 * Two states and nothing terminal: archiving is a lifecycle state, never a
 * deletion, and a restore brings the document back to whatever it held before.
 * With two states that can only be `ACTIVE` — nothing archives an archived
 * document — but restore still reads `preArchiveStatus` rather than assuming
 * it, so the field keeps the shape every other module's archive uses.
 *
 * This is not the storage lifecycle. `storageStatus` moves with both actions —
 * `AVAILABLE` to `ARCHIVED` and back — because it is what the download and
 * preview grants consult, and that side still answers to the table in
 * `lib/core/storage/storage-state.ts`, which the service asks before it writes.
 * Only a verified file can be archived: an upload in flight has to settle
 * first, and a file a submitted revision or an issued transmittal carries
 * cannot be archived at all. Both are checked by the service, not here.
 */
export type DocumentAction = "archive" | "restore";

export const documentMachine = defineStateMachine<DocumentStatus, DocumentAction>({
  key: "document",
  model: "document",
  field: "status",
  states: ["ACTIVE", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "archive", from: ["ACTIVE"], to: "ARCHIVED", permission: "document.archive", freezes: "its details, its file and its reviews, until it is restored" },
    { action: "restore", from: ["ARCHIVED"], to: ["ACTIVE"], permission: "document.restore" },
  ],
});
