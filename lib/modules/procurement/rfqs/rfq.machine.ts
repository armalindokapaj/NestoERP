import type { RFQStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The request-for-quotation lifecycle (PRD #19 §64-§77, §246; PRD #49 §132).
 *
 * Issuing needs a line and at least two invited suppliers — an enquiry to one
 * supplier is a price check, not a comparison (§72). The service refuses both
 * above the write (`RFQ_EMPTY`, `RFQ_TOO_FEW_SUPPLIERS`); the table cannot
 * count rows.
 *
 * Closing an enquiry stops new quotes, not the award: a quote may still be
 * selected on a closed enquiry, because the decision lives on the quotes.
 *
 * The invited suppliers have no machine of their own. Their rows carry no
 * company, only the enquiry's, and move as a consequence of a quote being
 * recorded or disqualified — each such write is guarded by the status it
 * read instead.
 */
export type RfqAction = "issue" | "close" | "cancel";

export const rfqMachine = defineStateMachine<RFQStatus, RfqAction>({
  key: "rfq",
  model: "rFQ",
  field: "status",
  states: ["DRAFT", "ISSUED", "CLOSED", "CANCELLED"],
  terminal: ["CLOSED", "CANCELLED"],
  transitions: [
    { action: "issue", from: ["DRAFT"], to: "ISSUED", permission: "procurement.rfq.issue", freezes: "the lines suppliers are asked to price" },
    { action: "close", from: ["ISSUED"], to: "CLOSED", permission: "procurement.rfq.close" },
    { action: "cancel", from: ["DRAFT", "ISSUED"], to: "CANCELLED", permission: "procurement.rfq.cancel" },
  ],
});
