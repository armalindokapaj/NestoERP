import type { UnitCommercialStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * A unit's commercial lifecycle (E-05E §7, §8, §19-§31; PRD #49 §54).
 *
 * Normal moves: on and off sale, a hold and its release, a reservation and its
 * release, expiry, and the sale. Reopening a sold unit is exceptional — its own
 * grant and a reason (§31). The reservation's own status moves with these in the
 * same transaction; a unit is Reserved exactly while it has an active
 * reservation.
 *
 * `expire_reservation` is driven by the reservation expiry job, which acts as the
 * system rather than a person: it checks the move against this table and writes
 * with the state it read in the `where`, like every worker transition
 * (docs/state-machines.md). Its permission is the one a person would need to end a
 * reservation early.
 */
export type UnitCommercialAction = "put_on_sale" | "take_off_sale" | "hold" | "release_hold" | "reserve" | "release_reservation" | "expire_reservation" | "mark_sold" | "reopen";

export const unitCommercialMachine = defineStateMachine<UnitCommercialStatus, UnitCommercialAction>({
  key: "unit_commercial",
  model: "unitCommercialProfile",
  field: "status",
  states: ["NOT_FOR_SALE", "FOR_SALE", "ON_HOLD", "RESERVED", "SOLD"],
  terminal: [],
  transitions: [
    { action: "put_on_sale", from: ["NOT_FOR_SALE"], to: "FOR_SALE", permission: "project.unit.sales_status.manage" },
    { action: "take_off_sale", from: ["FOR_SALE"], to: "NOT_FOR_SALE", permission: "project.unit.sales_status.manage" },
    { action: "hold", from: ["FOR_SALE"], to: "ON_HOLD", permission: "project.unit.sales_status.manage", requiresReason: true },
    { action: "release_hold", from: ["ON_HOLD"], to: "FOR_SALE", permission: "project.unit.sales_status.manage" },
    { action: "reserve", from: ["FOR_SALE", "ON_HOLD"], to: "RESERVED", permission: "project.unit.reserve" },
    { action: "release_reservation", from: ["RESERVED"], to: "FOR_SALE", permission: "project.unit.reservation.release", requiresReason: true },
    { action: "expire_reservation", from: ["RESERVED"], to: "FOR_SALE", permission: "project.unit.reservation.release" },
    { action: "mark_sold", from: ["RESERVED"], to: "SOLD", permission: "project.unit.mark_sold", freezes: "the reservation, converted to the sale, with its client, deal and agreed price" },
    { action: "reopen", from: ["SOLD"], to: ["FOR_SALE", "RESERVED"], permission: "project.unit.reopen_sale", requiresReason: true },
  ],
});
