import type { InventoryTransactionStatus } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import type { TransitionDefinition } from "@/lib/core/state/machine";

/**
 * The lifecycle every stock document shares (PRD #20 §280, §281; PRD #49 §123-§125).
 *
 * Receipts, issues, returns, transfers and adjustments are five tables with one
 * shape — drafted, then posted — so each declares its own machine, because a
 * machine governs one model, from the steps below. What differs between them is
 * who may take each step, and whether the document can be reversed at all.
 *
 * Posting is the only step that touches the ledger, and after it nothing moves
 * but a correcting movement. `StockMovement` has no state column to move, and
 * nothing in the application updates or deletes one: `applyStockMovement`
 * creates them and nothing else writes the table. A mistake is undone by
 * reversing the document, which writes an opposite movement pointing at the one
 * it undoes (`reversalOfMovementId`) — so the ledger keeps both what somebody
 * believed and what corrected it (PRD #20 §70, §100).
 */

export type StockDocumentAction = "post" | "cancel" | "reverse";

type Step = { from: readonly InventoryTransactionStatus[]; to: InventoryTransactionStatus };

/**
 * Where each step leads from and to — the part every document agrees on, and
 * what the `isTransaction…` helpers answer from.
 */
export const STOCK_DOCUMENT_STEPS: Record<StockDocumentAction, Step> = {
  post: { from: ["DRAFT"], to: "POSTED" },
  // Cancel before posting; reverse after. They are not the same act (PRD #20 §99, §100).
  cancel: { from: ["DRAFT"], to: "CANCELLED" },
  reverse: { from: ["POSTED"], to: "REVERSED" },
};

export function stockDocumentTransitions(permission: {
  post: Permission;
  cancel: Permission;
  /** Null for a document that is never reversed. */
  reverse: Permission | null;
}): TransitionDefinition<InventoryTransactionStatus, StockDocumentAction>[] {
  const transitions: TransitionDefinition<InventoryTransactionStatus, StockDocumentAction>[] = [
    { action: "post", ...STOCK_DOCUMENT_STEPS.post, permission: permission.post, freezes: "its lines, and the movements they posted" },
    { action: "cancel", ...STOCK_DOCUMENT_STEPS.cancel, permission: permission.cancel, freezes: "the whole draft" },
  ];
  if (permission.reverse) {
    transitions.push({ action: "reverse", ...STOCK_DOCUMENT_STEPS.reverse, permission: permission.reverse });
  }
  return transitions;
}
