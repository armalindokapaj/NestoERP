import type { InventoryItemStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The inventory item lifecycle (PRD #20 §25-§48).
 *
 * An active item can be moved; an inactive one stays in the catalogue and its
 * history but takes no new stock. Switching between the two is part of editing
 * the item, under the edit permission — the form carries the status, and the
 * service turns a change of it into `activate` or `deactivate`.
 *
 * Archiving needs the item to hold no stock, which the service checks against
 * the balances before the move. Restoring brings it back `INACTIVE` whatever it
 * was before: leaving the archive is not the same decision as being ready to
 * move again, so nothing is kept to restore to.
 */
export type InventoryItemAction = "activate" | "deactivate" | "archive" | "restore";

export const inventoryItemMachine = defineStateMachine<InventoryItemStatus, InventoryItemAction>({
  key: "inventory_item",
  model: "inventoryItem",
  field: "status",
  states: ["ACTIVE", "INACTIVE", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "activate", from: ["INACTIVE"], to: "ACTIVE", permission: "inventory.item.update" },
    { action: "deactivate", from: ["ACTIVE"], to: "INACTIVE", permission: "inventory.item.update" },
    { action: "archive", from: ["ACTIVE", "INACTIVE"], to: "ARCHIVED", permission: "inventory.item.archive", freezes: "the item's details, until it is restored" },
    { action: "restore", from: ["ARCHIVED"], to: "INACTIVE", permission: "inventory.item.restore" },
  ],
});
