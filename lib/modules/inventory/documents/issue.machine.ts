import type { InventoryTransactionStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";
import { stockDocumentTransitions, type StockDocumentAction } from "./document.transitions";

/**
 * The stock issue lifecycle (PRD #20 §104-§120; PRD #49 §123-§125).
 *
 * Posting is what consumes material, for the project the issue names. It is
 * also what fulfils a reservation a line draws on — that move belongs to
 * `stock_reservation` and is taken under this machine's `post` permission.
 *
 * Once posted the issue and its movements are fixed; a mistake is reversed,
 * which puts the stock back with opposite movements and undoes the project's
 * consumption without erasing that it happened.
 */
export const stockIssueMachine = defineStateMachine<InventoryTransactionStatus, StockDocumentAction>({
  key: "stock_issue",
  model: "stockIssue",
  field: "status",
  states: ["DRAFT", "POSTED", "CANCELLED", "REVERSED"],
  terminal: ["CANCELLED", "REVERSED"],
  transitions: stockDocumentTransitions({
    post: "inventory.issue.post",
    cancel: "inventory.issue.cancel",
    reverse: "inventory.issue.reverse",
  }),
});
