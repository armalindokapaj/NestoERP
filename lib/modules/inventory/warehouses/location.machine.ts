import type { InventoryLocationStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The inventory location lifecycle (PRD #20 §60-§66).
 *
 * A location is created active and, in V0.1, only ever archived — once it holds
 * no stock and is not its warehouse's default, both checked by the service
 * before the move. Nothing restores one, although `inventory.location.restore`
 * is in the catalogue, so `ARCHIVED` is terminal.
 *
 * `INACTIVE` is in the enum and nothing writes it. It is listed so a location
 * stored that way can still be archived, and no transition leads into it.
 */
export type InventoryLocationAction = "archive";

export const inventoryLocationMachine = defineStateMachine<InventoryLocationStatus, InventoryLocationAction>({
  key: "inventory_location",
  model: "inventoryLocation",
  field: "status",
  states: ["ACTIVE", "INACTIVE", "ARCHIVED"],
  terminal: ["ARCHIVED"],
  transitions: [
    { action: "archive", from: ["ACTIVE", "INACTIVE"], to: "ARCHIVED", permission: "inventory.location.archive" },
  ],
});
