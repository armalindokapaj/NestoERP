import type { StockReservationStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The stock reservation lifecycle (PRD #20 §152-§166; PRD #49 §123-§125).
 *
 * A reservation holds stock back while it is `ACTIVE` or `PARTIALLY_FULFILLED`,
 * and every ending gives back whatever it still held. The endings are different
 * facts and are kept apart: released is "we are not taking it after all",
 * cancelled is "it should never have been made", expired is "nobody came for
 * it", fulfilled is "we took it". Nothing moves physically, so none of them
 * writes a ledger row.
 *
 * Three things the table cannot say on its own:
 *
 *   `fulfill` is not an action anybody takes on a reservation. Posting an issue
 *   whose line draws on one fulfils it, so it carries the issue's `post`
 *   permission — `inventory.reservation.fulfill` is in the catalogue and nothing
 *   asks for it. The quantity consumed decides whether it lands partly or
 *   wholly fulfilled, so the service names which. No form sets a line's
 *   reservation yet, so today nothing reaches this.
 *
 *   `EXPIRED` is written, not derived: "Release expired" on the reservations
 *   page expires every holding reservation whose date has passed, under the
 *   release permission. Between runs the page derives an `expired` flag from
 *   the date instead, so a reservation can read as expired while still `ACTIVE`.
 *
 *   A second issue drawing on a reservation already partly fulfilled moves it
 *   from `PARTIALLY_FULFILLED` to `PARTIALLY_FULFILLED`; the state guard alone
 *   does not stop two such issues both counting from the same fulfilled figure.
 */
export type StockReservationAction = "release" | "cancel" | "expire" | "fulfill";

const HOLDING: StockReservationStatus[] = ["ACTIVE", "PARTIALLY_FULFILLED"];

export const stockReservationMachine = defineStateMachine<StockReservationStatus, StockReservationAction>({
  key: "stock_reservation",
  model: "stockReservation",
  field: "status",
  states: ["ACTIVE", "PARTIALLY_FULFILLED", "FULFILLED", "RELEASED", "CANCELLED", "EXPIRED"],
  terminal: ["FULFILLED", "RELEASED", "CANCELLED", "EXPIRED"],
  transitions: [
    { action: "release", from: HOLDING, to: "RELEASED", permission: "inventory.reservation.release" },
    { action: "cancel", from: HOLDING, to: "CANCELLED", permission: "inventory.reservation.cancel" },
    { action: "expire", from: HOLDING, to: "EXPIRED", permission: "inventory.reservation.release" },
    { action: "fulfill", from: HOLDING, to: ["PARTIALLY_FULFILLED", "FULFILLED"], permission: "inventory.issue.post" },
  ],
});
