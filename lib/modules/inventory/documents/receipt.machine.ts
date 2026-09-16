import type { InventoryTransactionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";
import { stockDocumentTransitions, type StockDocumentAction } from "./document.transitions";

/**
 * The inventory receipt lifecycle (PRD #20 §84-§103; PRD #49 §123-§125).
 *
 * Drafted by hand or from a Procurement delivery — which only ever drafts, so a
 * storeman still confirms the posting — then posted into stock. Once posted the
 * receipt and its movements are fixed; a mistake is reversed, which writes the
 * opposite movements rather than touching the ones already there.
 *
 * Cancelling a draft needs no grant of its own: whoever may draft a receipt may
 * withdraw one, which is what the service asks for.
 */
export const inventoryReceiptMachine = defineStateMachine<InventoryTransactionStatus, StockDocumentAction>({
  key: "inventory_receipt",
  model: "inventoryReceipt",
  field: "status",
  states: ["DRAFT", "POSTED", "CANCELLED", "REVERSED"],
  terminal: ["CANCELLED", "REVERSED"],
  transitions: stockDocumentTransitions({
    post: "inventory.receipt.post",
    cancel: "inventory.receipt.create",
    reverse: "inventory.receipt.reverse",
  }),
});
