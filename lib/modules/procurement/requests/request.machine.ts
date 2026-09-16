import type { PurchaseRequestStatus } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The purchase request lifecycle (PRD #19 §41-§63, §245; PRD #41 §48; PRD #49 §132).
 *
 * A request is asked for, decided, sourced, and then follows what is ordered
 * against it. Those last moves — partly ordered, ordered, completed — are
 * nobody's click: they are re-derived from the request's orders whenever one
 * is issued, cancelled, closed or received against, so they carry the
 * permission of every entry point that re-derives them. They only move
 * forward: an order cancelled after the request was fully ordered leaves it
 * ordered.
 *
 * Three things the table says that the enum alone does not:
 *
 *   a rejected request is corrected where it stands and submitted again — it
 *   is editable while `REJECTED`, and nothing moves it back to `DRAFT`; only a
 *   return for revision does that, from `PENDING_APPROVAL`;
 *
 *   an order raised straight from an `APPROVED` request moves nothing: the
 *   ordering states follow sourcing, and sourcing starts when an enquiry is
 *   raised against the request or somebody starts it by hand;
 *
 *   leaving the archive returns whatever the request held before, which can
 *   only be one of the states it could be archived from.
 */
export type PurchaseRequestAction =
  | "submit"
  | "approve"
  | "reject"
  | "return"
  | "start_sourcing"
  | "partially_order"
  | "order"
  | "complete"
  | "cancel"
  | "archive"
  | "restore";

/** Every entry point that re-derives the ordering states: the order and receipt actions. */
const ORDERING: Permission[] = [
  "procurement.order.issue",
  "procurement.order.cancel",
  "procurement.order.close",
  "procurement.receipt.create",
  "procurement.receipt.void",
];

export const purchaseRequestMachine = defineStateMachine<PurchaseRequestStatus, PurchaseRequestAction>({
  key: "purchase_request",
  model: "purchaseRequest",
  field: "status",
  states: [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "IN_SOURCING",
    "PARTIALLY_ORDERED",
    "ORDERED",
    "COMPLETED",
    "CANCELLED",
    "ARCHIVED",
  ],
  terminal: [],
  transitions: [
    { action: "submit", from: ["DRAFT", "REJECTED"], to: "PENDING_APPROVAL", permission: "procurement.request.submit" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: "procurement.request.approve", freezes: "the lines asked for" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: "procurement.request.reject" },
    { action: "return", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: "procurement.request.reject" },
    // Started by hand, or by the first enquiry raised against the request —
    // both of which need the right to raise one.
    { action: "start_sourcing", from: ["APPROVED"], to: "IN_SOURCING", permission: "procurement.rfq.create" },
    { action: "partially_order", from: ["IN_SOURCING"], to: "PARTIALLY_ORDERED", permission: ORDERING },
    { action: "order", from: ["IN_SOURCING", "PARTIALLY_ORDERED"], to: "ORDERED", permission: ORDERING },
    { action: "complete", from: ["ORDERED"], to: "COMPLETED", permission: ORDERING },
    {
      action: "cancel",
      from: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "IN_SOURCING", "PARTIALLY_ORDERED"],
      to: "CANCELLED",
      permission: "procurement.request.cancel",
    },
    { action: "archive", from: ["DRAFT", "CANCELLED", "COMPLETED"], to: "ARCHIVED", permission: "procurement.request.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ["DRAFT", "CANCELLED", "COMPLETED"], permission: "procurement.request.restore" },
  ],
});
