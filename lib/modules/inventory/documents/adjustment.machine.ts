import type { InventoryTransactionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";
import { stockDocumentTransitions, type StockDocumentAction } from "./document.transitions";

/**
 * The stock adjustment lifecycle (PRD #20 §141-§151; PRD #49 §123-§125).
 *
 * The one document that can make stock appear without anything arriving, which
 * is why every step sits behind its own permission. Its reason — an opening
 * balance, a count, damage — is fixed with the lines once it is posted.
 *
 * Once posted the adjustment and its movements are fixed; a mistake is
 * reversed, which writes the opposite movements rather than editing the
 * correction in place.
 */
export const stockAdjustmentMachine = defineStateMachine<InventoryTransactionStatus, StockDocumentAction>({
  key: "stock_adjustment",
  model: "stockAdjustment",
  field: "status",
  states: ["DRAFT", "POSTED", "CANCELLED", "REVERSED"],
  terminal: ["CANCELLED", "REVERSED"],
  transitions: stockDocumentTransitions({
    post: "inventory.adjustment.post",
    cancel: "inventory.adjustment.cancel",
    reverse: "inventory.adjustment.reverse",
  }),
});
