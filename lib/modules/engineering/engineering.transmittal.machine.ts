import type { TransmittalStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The transmittal lifecycle (PRD #46 §118-§124; PRD #49 §149, §150).
 *
 *   DRAFT → ISSUED → VOID
 *
 * Issuing fixes the items and the exact file version each carried, and those
 * files take no new versions afterwards (§149). A mistake is not edited out of
 * an issued transmittal: it is voided, with a reason, and a new one issued
 * (§150). A draft may be voided as well as edited.
 */
export type DocumentTransmittalAction = "issue" | "void";

export const documentTransmittalMachine = defineStateMachine<TransmittalStatus, DocumentTransmittalAction>({
  key: "document_transmittal",
  model: "documentTransmittal",
  field: "status",
  states: ["DRAFT", "ISSUED", "VOID"],
  terminal: ["VOID"],
  transitions: [
    { action: "issue", from: ["DRAFT"], to: "ISSUED", permission: "transmittal.issue", freezes: "its items and the file version each carried" },
    { action: "void", from: ["DRAFT", "ISSUED"], to: "VOID", permission: "transmittal.void", requiresReason: true },
  ],
});
