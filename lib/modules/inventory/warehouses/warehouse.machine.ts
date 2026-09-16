import type { WarehouseStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The warehouse lifecycle (PRD #20 §49-§66).
 *
 * Only an active warehouse can take or give stock. Switching it on or off is
 * part of editing it, under the edit permission — the form carries the status,
 * and the service turns a change of it into `activate` or `deactivate`.
 *
 * Archiving needs the warehouse to hold no stock, which the service checks
 * against the balances before the move. Restoring brings it back `INACTIVE`
 * whatever it was before, so nothing is kept to restore to.
 */
export type WarehouseAction = "activate" | "deactivate" | "archive" | "restore";

export const warehouseMachine = defineStateMachine<WarehouseStatus, WarehouseAction>({
  key: "warehouse",
  model: "warehouse",
  field: "status",
  states: ["ACTIVE", "INACTIVE", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "activate", from: ["INACTIVE"], to: "ACTIVE", permission: "inventory.warehouse.update" },
    { action: "deactivate", from: ["ACTIVE"], to: "INACTIVE", permission: "inventory.warehouse.update" },
    { action: "archive", from: ["ACTIVE", "INACTIVE"], to: "ARCHIVED", permission: "inventory.warehouse.archive", freezes: "the warehouse's details, until it is restored" },
    { action: "restore", from: ["ARCHIVED"], to: "INACTIVE", permission: "inventory.warehouse.restore" },
  ],
});
