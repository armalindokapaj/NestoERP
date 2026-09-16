import type { InventoryTransactionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";
import { stockDocumentTransitions, type StockDocumentAction } from "./document.transitions";

/**
 * The stock transfer lifecycle (PRD #20 §129-§140; PRD #49 §123-§125).
 *
 * Posting writes two movements per line, out of one location and into another,
 * in the same transaction as the move to `POSTED` — there is no state in which
 * a transfer has left one place and not arrived at the other.
 *
 * Once posted the transfer and its movements are fixed; a mistake is reversed,
 * which writes the opposite of both halves.
 */
export const stockTransferMachine = defineStateMachine<InventoryTransactionStatus, StockDocumentAction>({
  key: "stock_transfer",
  model: "stockTransfer",
  field: "status",
  states: ["DRAFT", "POSTED", "CANCELLED", "REVERSED"],
  terminal: ["CANCELLED", "REVERSED"],
  transitions: stockDocumentTransitions({
    post: "inventory.transfer.post",
    cancel: "inventory.transfer.cancel",
    reverse: "inventory.transfer.reverse",
  }),
});
