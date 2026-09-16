import type { InventoryTransactionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";
import { stockDocumentTransitions, type StockDocumentAction } from "./document.transitions";

/**
 * The stock return lifecycle (PRD #20 §121-§128; PRD #49 §123-§125).
 *
 * The one stock document that is never reversed. The material is physically
 * back on the shelf, and a return that turns out wrong is corrected by an
 * adjustment with a reason (PRD #20 §122) — so a posted return is final, and
 * its movements, like every movement, are never changed.
 *
 * That is why `REVERSED` is missing from the states below although the enum,
 * shared with the other four documents, carries it: nothing writes it for a
 * return and nothing could leave it, and a state no transition reaches or
 * leaves is not part of this record's lifecycle.
 *
 * Cancelling a draft needs no grant of its own: whoever may draft a return may
 * withdraw one.
 */
export const stockReturnMachine = defineStateMachine<InventoryTransactionStatus, StockDocumentAction>({
  key: "stock_return",
  model: "stockReturn",
  field: "status",
  states: ["DRAFT", "POSTED", "CANCELLED"],
  terminal: ["POSTED", "CANCELLED"],
  transitions: stockDocumentTransitions({
    post: "inventory.return.post",
    cancel: "inventory.return.create",
    reverse: null,
  }),
});
