import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import {
  canSeeStock,
  loadMemberRef,
  toItemRef,
  toLocationRef,
  toWarehouseRef,
} from "../inventory.dto";
import { ZERO, quantityString } from "../inventory.quantity";
import {
  buildBalanceScopeWhere,
  buildItemScopeWhere,
  buildWarehouseScopeWhere,
} from "../inventory.scope";
import type { ItemInput, ItemListQuery } from "../inventory.schema";
import { needsAttention, stockLevelFor, type StockLevel } from "../inventory.status";
import type { ItemDetailDTO, ItemSummaryDTO, StockRowDTO } from "../inventory.types";

/**
 * Inventory items (PRD #20 §25–§48).
 *
 * An item is a *kind* of thing, not a quantity of one. How much exists is
 * summed from the balance projection at read time, and only for a reader who
 * may see stock figures — the catalogue itself is company-wide, the quantities
 * are not (PRD #20 §20).
 *
 * The base unit is immutable once stock exists. Changing it would silently
 * reinterpret every movement ever recorded against the item: forty "bags"
 * becoming forty "tonnes" is not an edit, it is a different fact (PRD #20 §46).
 */

const MODULE = "inventory" as const;
const ENTITY = "InventoryItem";

const ITEM_SELECT = {
  id: true,
  sku: true,
  name: true,
  description: true,
  category: true,
  baseUnit: true,
  status: true,
  minimumStock: true,
  reorderPoint: true,
  defaultWarehouseId: true,
  defaultLocationId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdByMemberId: true,
} satisfies Prisma.InventoryItemSelect;

type ItemRow = Prisma.InventoryItemGetPayload<{ select: typeof ITEM_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listItems(context: UserContext, query: ItemListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.item.view");

  const filters: Prisma.InventoryItemWhereInput[] = [buildItemScopeWhere(context)];

  if (query.view === "archived") filters.push({ archivedAt: { not: null } });
  else filters.push({ archivedAt: null });

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.category?.length) filters.push({ category: { in: query.category } });
  if (query.warehouseId) {
    filters.push({ balances: { some: { warehouseId: query.warehouseId } } });
  }

  const search = searchClause(query.search, ["sku", "name", "description"]);
  if (search) filters.push(search);

  const where: Prisma.InventoryItemWhereInput = { AND: filters };

  // The low-stock view needs every candidate before it can rank them, because
  // "low" is a comparison between two columns Prisma cannot filter on.
  const lowStockView = query.view === "low-stock";

  const page: { skip: number; take: number } = lowStockView
    ? { skip: 0, take: 500 }
    : { skip: skipFor(query.page, query.limit), take: query.limit };

  const [rows, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      orderBy: orderFor(query.sort),
      skip: page.skip,
      take: page.take,
      select: ITEM_SELECT,
    }),
    prisma.inventoryItem.count({ where }),
  ]);

  const stock = await stockForItems(context, rows.map((row) => row.id));
  let data = rows.map((row) => toSummaryDTO(context, row, stock.get(row.id)));

  if (lowStockView) {
    data = data.filter((item) => needsAttention(item.level));
    const page = data.slice(skipFor(query.page, query.limit), skipFor(query.page, query.limit) + query.limit);
    return { data: page, pagination: paginationMeta(data.length, query.page, query.limit) };
  }

  return { data, pagination: paginationMeta(total, query.page, query.limit) };
}

function orderFor(sort: ItemListQuery["sort"]): Prisma.InventoryItemOrderByWithRelationInput[] {
  switch (sort) {
    case "sku-asc":
      return [{ sku: "asc" }];
    case "updated-desc":
      return [{ updatedAt: "desc" }];
    case "created-desc":
      return [{ createdAt: "desc" }];
    default:
      return [{ name: "asc" }];
  }
}

/**
 * On-hand, reserved and available per item, summed across locations in one
 * grouped query (PRD #20 §180).
 *
 * A list of fifty items must not become fifty-one queries. Returns an empty map
 * for a reader without balance permission, so the caller renders no figures at
 * all rather than zeros.
 */
async function stockForItems(
  context: UserContext,
  itemIds: string[],
): Promise<Map<string, { onHand: Prisma.Decimal; reserved: Prisma.Decimal }>> {
  if (!canSeeStock(context) || itemIds.length === 0) return new Map();

  const rows = await prisma.inventoryBalance.groupBy({
    by: ["inventoryItemId"],
    where: { AND: [buildBalanceScopeWhere(context), { inventoryItemId: { in: itemIds } }] },
    _sum: { onHandQuantity: true, reservedQuantity: true },
  });

  return new Map(
    rows.map((row) => [
      row.inventoryItemId,
      {
        onHand: row._sum.onHandQuantity ?? ZERO,
        reserved: row._sum.reservedQuantity ?? ZERO,
      },
    ]),
  );
}

export async function getItem(context: UserContext, itemId: string): Promise<ItemDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.item.view");

  const row = assertFound(
    await prisma.inventoryItem.findFirst({
      where: { AND: [buildItemScopeWhere(context), { id: itemId }] },
      select: ITEM_SELECT,
    }),
  );

  const [stock, byLocation, createdBy, defaults] = await Promise.all([
    stockForItems(context, [itemId]),
    stockByLocation(context, itemId),
    loadMemberRef(row.createdByMemberId),
    loadDefaults(context, row),
  ]);

  return {
    ...toSummaryDTO(context, row, stock.get(itemId)),
    description: row.description,
    defaultWarehouse: defaults.warehouse,
    defaultLocation: defaults.location,
    byLocation,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: capabilitiesFor(context, row),
  };
}

/** Where one item physically is, one row per location holding it (§180). */
export async function stockByLocation(
  context: UserContext,
  itemId: string,
): Promise<StockRowDTO[]> {
  if (!canSeeStock(context)) return [];

  const rows = await prisma.inventoryBalance.findMany({
    where: { AND: [buildBalanceScopeWhere(context), { inventoryItemId: itemId }] },
    orderBy: [{ warehouse: { code: "asc" } }, { location: { code: "asc" } }],
    select: BALANCE_SELECT,
  });

  return rows.map(toStockRow);
}

export const BALANCE_SELECT = {
  onHandQuantity: true,
  reservedQuantity: true,
  availableQuantity: true,
  updatedAt: true,
  inventoryItem: {
    select: { id: true, sku: true, name: true, baseUnit: true, minimumStock: true, reorderPoint: true },
  },
  warehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  location: { select: { id: true, code: true, name: true, warehouseId: true } },
} satisfies Prisma.InventoryBalanceSelect;

export function toStockRow(
  row: Prisma.InventoryBalanceGetPayload<{ select: typeof BALANCE_SELECT }>,
): StockRowDTO {
  return {
    item: toItemRef(row.inventoryItem)!,
    warehouse: toWarehouseRef(row.warehouse)!,
    location: toLocationRef(row.location)!,
    onHand: quantityString(row.onHandQuantity),
    reserved: quantityString(row.reservedQuantity),
    available: quantityString(row.availableQuantity),
    level: stockLevelFor({
      onHand: Number(row.onHandQuantity),
      minimumStock: row.inventoryItem.minimumStock === null ? null : Number(row.inventoryItem.minimumStock),
      reorderPoint: row.inventoryItem.reorderPoint === null ? null : Number(row.inventoryItem.reorderPoint),
    }),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadDefaults(context: UserContext, row: ItemRow) {
  const [warehouse, location] = await Promise.all([
    row.defaultWarehouseId
      ? prisma.warehouse.findFirst({
          where: { AND: [buildWarehouseScopeWhere(context), { id: row.defaultWarehouseId }] },
          select: { id: true, code: true, name: true, warehouseType: true },
        })
      : Promise.resolve(null),
    row.defaultLocationId
      ? prisma.inventoryLocation.findFirst({
          where: { id: row.defaultLocationId, companyId: context.companyId },
          select: { id: true, code: true, name: true, warehouseId: true },
        })
      : Promise.resolve(null),
  ]);

  return { warehouse: toWarehouseRef(warehouse), location: toLocationRef(location) };
}

/** Items a stock document may name: active ones only (PRD #20 §30). */
export async function selectableItems(
  context: UserContext,
): Promise<{ value: string; label: string; unit: string }[]> {
  if (!can(context, "inventory.item.view")) return [];

  const rows = await prisma.inventoryItem.findMany({
    where: { AND: [buildItemScopeWhere(context), { status: "ACTIVE", archivedAt: null }] },
    select: { id: true, sku: true, name: true, baseUnit: true },
    orderBy: { name: "asc" },
  });

  return rows.map((row) => ({
    value: row.id,
    label: `${row.sku} — ${row.name}`,
    unit: row.baseUnit,
  }));
}

export async function itemFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.item.view");

  const warehouses = await prisma.warehouse.findMany({
    where: buildWarehouseScopeWhere(context),
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { warehouses };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createItem(context: UserContext, input: ItemInput): Promise<ItemDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.item.create");

  const id = await prisma.$transaction(async (tx) => {
    await assertSkuIsFree(tx, context, input.sku, null);

    const item = await tx.inventoryItem.create({
      data: {
        companyId: context.companyId,
        sku: input.sku,
        name: input.name,
        description: input.description ?? null,
        category: input.category,
        baseUnit: input.baseUnit,
        status: input.status,
        minimumStock: input.minimumStock === undefined ? null : new Prisma.Decimal(input.minimumStock),
        reorderPoint: input.reorderPoint === undefined ? null : new Prisma.Decimal(input.reorderPoint),
        defaultWarehouseId: input.defaultWarehouseId ?? null,
        defaultLocationId: input.defaultLocationId ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, sku: true, name: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: item.id,
      action: "INVENTORY_ITEM_CREATED",
      message: `added item ${item.sku} — ${item.name}`,
    });

    return item.id;
  });

  return getItem(context, id);
}

export async function updateItem(
  context: UserContext,
  itemId: string,
  input: ItemInput,
): Promise<ItemDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.item.update");

  const existing = assertFound(
    await prisma.inventoryItem.findFirst({
      where: { AND: [buildItemScopeWhere(context), { id: itemId }] },
      select: { id: true, sku: true, baseUnit: true, archivedAt: true, updatedAt: true },
    }),
  );

  if (existing.archivedAt) {
    throw new AccessError("CONFLICT", "Restore this item before editing it.", {
      code: "ITEM_ARCHIVED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  /*
   * The base unit is a promise about every movement ever recorded against this
   * item. Once stock has moved, changing it would silently reinterpret the
   * ledger (PRD #20 §46).
   */
  if (input.baseUnit !== existing.baseUnit) {
    const moved = await prisma.stockMovement.count({ where: { inventoryItemId: itemId } });
    if (moved > 0) {
      throw new AccessError(
        "CONFLICT",
        "This item already has stock history, so its unit cannot change. Create a new item instead.",
        { code: "BASE_UNIT_IMMUTABLE" },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await assertSkuIsFree(tx, context, input.sku, itemId);

    await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        sku: input.sku,
        name: input.name,
        description: input.description ?? null,
        category: input.category,
        baseUnit: input.baseUnit,
        status: input.status,
        minimumStock: input.minimumStock === undefined ? null : new Prisma.Decimal(input.minimumStock),
        reorderPoint: input.reorderPoint === undefined ? null : new Prisma.Decimal(input.reorderPoint),
        defaultWarehouseId: input.defaultWarehouseId ?? null,
        defaultLocationId: input.defaultLocationId ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: itemId,
      action: "INVENTORY_ITEM_UPDATED",
      message: `updated item ${input.sku}`,
    });
  });

  return getItem(context, itemId);
}

export async function archiveItem(context: UserContext, itemId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.item.archive");

  const existing = assertFound(
    await prisma.inventoryItem.findFirst({
      where: { AND: [buildItemScopeWhere(context), { id: itemId }] },
      select: { id: true, sku: true, archivedAt: true },
    }),
  );

  if (existing.archivedAt) return;

  // Archiving something the company still physically holds would hide stock
  // that is sitting on a shelf (PRD #20 §47).
  const held = await prisma.inventoryBalance.aggregate({
    where: { inventoryItemId: itemId },
    _sum: { onHandQuantity: true },
  });

  if ((held._sum.onHandQuantity ?? ZERO).greaterThan(ZERO)) {
    throw new AccessError(
      "CONFLICT",
      "There is still stock of this item on hand. Issue or adjust it out first.",
      { code: "ITEM_HAS_STOCK" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        status: "ARCHIVED",
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: itemId,
      action: "INVENTORY_ITEM_ARCHIVED",
      message: `archived item ${existing.sku}`,
    });
  });
}

export async function restoreItem(context: UserContext, itemId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.item.restore");

  const existing = assertFound(
    await prisma.inventoryItem.findFirst({
      where: { AND: [buildItemScopeWhere(context), { id: itemId }] },
      select: { id: true, sku: true, archivedAt: true },
    }),
  );

  if (!existing.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    await tx.inventoryItem.update({
      where: { id: itemId },
      // Back as INACTIVE: leaving the archive is not the same decision as being
      // ready to move again.
      data: { status: "INACTIVE", archivedAt: null, archivedByMemberId: null },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: itemId,
      action: "INVENTORY_ITEM_RESTORED",
      message: `restored item ${existing.sku}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function assertSkuIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  sku: string,
  excludeId: string | null,
): Promise<void> {
  const clash = await tx.inventoryItem.findFirst({
    where: {
      companyId: context.companyId,
      sku,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError("CONFLICT", `SKU ${sku} is already in use.`, { code: "SKU_TAKEN" });
  }
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this item while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  context: UserContext,
  row: ItemRow,
  stock: { onHand: Prisma.Decimal; reserved: Prisma.Decimal } | undefined,
): ItemSummaryDTO {
  const seeStock = canSeeStock(context);
  const onHand = stock?.onHand ?? ZERO;
  const reserved = stock?.reserved ?? ZERO;

  const level: StockLevel = seeStock
    ? stockLevelFor({
        onHand: Number(onHand),
        minimumStock: row.minimumStock === null ? null : Number(row.minimumStock),
        reorderPoint: row.reorderPoint === null ? null : Number(row.reorderPoint),
      })
    : "NOT_TRACKED";

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    baseUnit: row.baseUnit,
    status: row.status,
    minimumStock: row.minimumStock === null ? null : quantityString(row.minimumStock),
    reorderPoint: row.reorderPoint === null ? null : quantityString(row.reorderPoint),
    // Absent, not zero, for a reader with no stock permission (PRD #20 §20).
    stock: seeStock
      ? {
          onHand: quantityString(onHand),
          reserved: quantityString(reserved),
          available: quantityString(onHand.minus(reserved)),
        }
      : null,
    level,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: ItemRow) {
  const archived = row.archivedAt !== null;
  return {
    canEdit: !archived && can(context, "inventory.item.update"),
    canArchive: !archived && can(context, "inventory.item.archive"),
    canRestore: archived && can(context, "inventory.item.restore"),
    canViewStock: canSeeStock(context),
    canViewMovements: can(context, "inventory.movement.view"),
    canViewDocuments: can(context, "inventory.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "inventory.activity.view"),
  };
}
