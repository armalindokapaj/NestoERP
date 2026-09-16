import type { SupplierStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The supplier directory lifecycle (PRD #19 §26-§40; PRD #49 §132).
 *
 * Active and inactive are chosen on the supplier form, alongside the rest of
 * its details: saving a form whose status differs from the one it was opened
 * on is the transition, under the right to edit the supplier.
 *
 * Restoring from the archive lands on `INACTIVE`, whatever the supplier was
 * before — coming out of the archive is not the same decision as being ready
 * to buy from again. Archiving is refused while an order to the supplier is
 * still running (`SUPPLIER_HAS_OPEN_ORDERS`, §37), which the service checks
 * above the write.
 */
export type SupplierAction = "activate" | "deactivate" | "archive" | "restore";

export const supplierMachine = defineStateMachine<SupplierStatus, SupplierAction>({
  key: "supplier",
  model: "supplier",
  field: "status",
  states: ["ACTIVE", "INACTIVE", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "activate", from: ["INACTIVE"], to: "ACTIVE", permission: "procurement.supplier.update" },
    { action: "deactivate", from: ["ACTIVE"], to: "INACTIVE", permission: "procurement.supplier.update" },
    { action: "archive", from: ["ACTIVE", "INACTIVE"], to: "ARCHIVED", permission: "procurement.supplier.archive" },
    { action: "restore", from: ["ARCHIVED"], to: "INACTIVE", permission: "procurement.supplier.restore" },
  ],
});
