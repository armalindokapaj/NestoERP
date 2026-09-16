import type { GoodsReceiptStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The goods receipt lifecycle (PRD #19 §132-§147; PRD #49 §132).
 *
 * A receipt is somebody's statement about a delivery that happened. It is
 * never edited: a correction is a new receipt, or a void that keeps the row
 * and its reason and stops it counting (§143, §144).
 *
 * Voiding is refused while another module has acted on the delivery —
 * Inventory has booked it in, or Quality has released or decided on it — and
 * that check lives in the service, above the write, because only the owners of
 * those records can say what reversing them means (PRD #21 §104, PRD #20
 * §370). The void re-derives the order's receiving in the same transaction.
 */
export type GoodsReceiptAction = "void";

export const goodsReceiptMachine = defineStateMachine<GoodsReceiptStatus, GoodsReceiptAction>({
  key: "goods_receipt",
  model: "goodsReceipt",
  field: "status",
  states: ["RECORDED", "VOIDED"],
  terminal: ["VOIDED"],
  transitions: [{ action: "void", from: ["RECORDED"], to: "VOIDED", permission: "procurement.receipt.void" }],
});
