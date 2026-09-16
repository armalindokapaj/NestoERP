import type { PurchaseOrderStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The purchase order lifecycle (PRD #19 §95-§131, §248; PRD #41 §21, §48; PRD #49 §132).
 *
 * Approving, rejecting and returning an order above the company's approval
 * limits is concluded by a chain — Procurement, then Finance, then an
 * executive — and whoever holds the chain's last step decides it, by name, by
 * role or standing in for either, whether or not they hold the order
 * permission. Below the limits it is one decision under that permission.
 *
 * Receiving is derived from quantity, never clicked (§141). Recording a
 * receipt or voiding one re-derives the order from what the recorded receipts
 * add up to, so the move goes both ways — a void can leave a received order
 * partly received, or issued again — and carries both permissions.
 *
 * One rule the table cannot express, checked by the service above the write:
 * an issued order may be cancelled only while nothing has been received
 * against it (`ORDER_HAS_RECEIPTS`, §129). The goods on site are a fact; an
 * order with receipts is closed short instead.
 *
 * Leaving the archive returns whatever the order held before, which can only
 * be one of the states it could be archived from.
 */
export type PurchaseOrderAction =
  | "submit"
  | "approve"
  | "reject"
  | "return"
  | "issue"
  | "reconcile_receipts"
  | "cancel"
  | "close"
  | "archive"
  | "restore";

const RECEIVING: PurchaseOrderStatus[] = ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"];

export const purchaseOrderMachine = defineStateMachine<PurchaseOrderStatus, PurchaseOrderAction>({
  key: "purchase_order",
  model: "purchaseOrder",
  field: "status",
  states: [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "ISSUED",
    "PARTIALLY_RECEIVED",
    "RECEIVED",
    "CLOSED",
    "CANCELLED",
    "ARCHIVED",
  ],
  terminal: [],
  transitions: [
    { action: "submit", from: ["DRAFT", "REJECTED"], to: "PENDING_APPROVAL", permission: "procurement.order.submit" },
    {
      action: "approve",
      from: ["PENDING_APPROVAL"],
      to: "APPROVED",
      permission: "procurement.order.approve",
      concludedByApprovalStep: true,
      freezes: "the lines and the amount committed",
    },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: "procurement.order.reject", concludedByApprovalStep: true },
    { action: "return", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: "procurement.order.reject", concludedByApprovalStep: true },
    { action: "issue", from: ["APPROVED"], to: "ISSUED", permission: "procurement.order.issue" },
    {
      action: "reconcile_receipts",
      from: RECEIVING,
      to: RECEIVING,
      permission: ["procurement.receipt.create", "procurement.receipt.void"],
    },
    {
      action: "cancel",
      from: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "ISSUED"],
      to: "CANCELLED",
      permission: "procurement.order.cancel",
    },
    { action: "close", from: ["PARTIALLY_RECEIVED", "RECEIVED"], to: "CLOSED", permission: "procurement.order.close" },
    { action: "archive", from: ["DRAFT", "CLOSED", "CANCELLED"], to: "ARCHIVED", permission: "procurement.order.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ["DRAFT", "CLOSED", "CANCELLED"], permission: "procurement.order.restore" },
  ],
});
