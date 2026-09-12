import { can } from "@/lib/access/can";
import { assertModule } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { buildBalanceScopeWhere, buildInventoryProjectWhere } from "./inventory.scope";
import * as items from "./items/item.service";
import * as warehouses from "./warehouses/warehouse.service";

/**
 * What a stock document's pickers may offer (PRD #20 §296, §297).
 *
 * Every list is resolved through the reader's own scope, so a picker never
 * becomes a directory of warehouses, projects or items they cannot otherwise
 * discover. A dropdown is a search result like any other.
 */

export type ItemOption = { value: string; label: string; unit: string };
export type LocationOption = { value: string; label: string; warehouseId: string };
export type Option = { value: string; label: string };

export type DocumentFormOptions = {
  items: ItemOption[];
  warehouses: Option[];
  locations: LocationOption[];
  projects: Option[];
  members: Option[];
};

export async function documentFormOptions(
  context: UserContext,
): Promise<DocumentFormOptions> {
  assertModule(context, "inventory");

  const [itemRows, warehouseRows, locationRows, projectRows, memberRows] = await Promise.all([
    items.selectableItems(context),
    warehouses.selectableWarehouses(context),
    warehouses.selectableLocations(context),
    prisma.project.findMany({
      where: buildInventoryProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, status: "ACTIVE", archivedAt: null },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return {
    items: itemRows,
    warehouses: warehouseRows,
    locations: locationRows,
    projects: projectRows.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` })),
    members: memberRows.map((row) => ({
      value: row.id,
      label: `${row.user.firstName} ${row.user.lastName}`,
    })),
  };
}

/**
 * Where stock already is, so a line picker can show what it is about to move.
 *
 * Only rows holding something, and only within the reader's scope: an empty
 * bin is not useful information on a form (PRD #20 §180).
 */
export async function heldBalances(
  context: UserContext,
): Promise<{ inventoryItemId: string; locationId: string; onHand: string; available: string }[]> {
  if (!can(context, "inventory.balance.view")) return [];

  const rows = await prisma.inventoryBalance.findMany({
    where: {
      AND: [
        buildBalanceScopeWhere(context),
        { onHandQuantity: { gt: 0 }, warehouse: { is: { status: "ACTIVE" } } },
      ],
    },
    select: {
      inventoryItemId: true,
      locationId: true,
      onHandQuantity: true,
      availableQuantity: true,
    },
  });

  return rows.map((row) => ({
    inventoryItemId: row.inventoryItemId,
    locationId: row.locationId,
    onHand: row.onHandQuantity.toFixed(4),
    available: row.availableQuantity.toFixed(4),
  }));
}
