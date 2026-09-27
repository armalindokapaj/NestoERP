import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { recordActivity } from "@/lib/modules/shared/activity";
import { pageWindow, searchClause, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
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
import { inventoryItemMachine } from "./item.machine";

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

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

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

  /*
   * "Low" and "lowest stock first" compare an item's summed balances with its
   * own thresholds, which Prisma cannot filter or sort on. So the derived path
   * classifies every item the scope and filters match — ids, thresholds and one
   * grouped sum, no row cap — then sorts, counts and pages that set, and reads
   * full rows for the page alone (AUD-08 §3's pipeline: filters → derived
   * classification → stable sort → pagination; DT-03, DT-04). It used to rank
   * only the first 500 items by name, so a low item beyond them was missing and
   * the count said so.
   */
  if (query.view === "low-stock" || query.sort === "stock-asc") return listItemsDerived(context, query, where);

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "inventory.items.list",
    async (tx) => {
      const window = pageWindow(await tx.inventoryItem.count({ where }), query.page, query.limit);
      const rows = await tx.inventoryItem.findMany({
        where,
        orderBy: withTieBreaker(orderFor(query.sort)),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: ITEM_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const stock = await stockForItems(context, rows.map((row) => row.id));
  return { data: rows.map((row) => toSummaryDTO(context, row, stock.get(row.id))), pagination: window };
}

/** The low-stock view and the stock sort: classified and ordered over every match, then paged. */
async function listItemsDerived(context: UserContext, query: ItemListQuery, where: Prisma.InventoryItemWhereInput) {
  const { rows, window, stock } = await runInTransaction(
    "inventory.items.derived-list",
    async (tx) => {
      const candidates = await tx.inventoryItem.findMany({
        where,
        // The name order (then id) is the tie-break for equal stock, and the whole order of the low-stock view.
        orderBy: withTieBreaker<Prisma.InventoryItemOrderByWithRelationInput>(query.sort === "stock-asc" ? [{ name: "asc" }] : orderFor(query.sort)),
        select: { id: true, minimumStock: true, reorderPoint: true },
      });
      const sums = await stockForItems(context, candidates.map((row) => row.id), tx);
      const onHand = (id: string) => sums.get(id)?.onHand ?? ZERO;
      let ordered = candidates;
      if (query.view === "low-stock") {
        // Without stock permission nothing is classified, as on the rows themselves (PRD #20 §20).
        ordered = canSeeStock(context)
          ? ordered.filter((row) =>
              needsAttention(
                stockLevelFor({
                  onHand: Number(onHand(row.id)),
                  minimumStock: row.minimumStock === null ? null : Number(row.minimumStock),
                  reorderPoint: row.reorderPoint === null ? null : Number(row.reorderPoint),
                }),
              ),
            )
          : [];
      }
      if (query.sort === "stock-asc") {
        // Decimal comparison of the raw sums; equal stock keeps the name-then-id order (stable sort).
        ordered = [...ordered].sort((a, b) => onHand(a.id).comparedTo(onHand(b.id)));
      }
      const window = pageWindow(ordered.length, query.page, query.limit);
      const pageIds = ordered.slice(skipFor(window.page, window.limit), skipFor(window.page, window.limit) + window.limit).map((row) => row.id);
      const found = await tx.inventoryItem.findMany({ where: { id: { in: pageIds } }, select: ITEM_SELECT });
      const byId = new Map(found.map((row) => [row.id, row]));
      return { rows: pageIds.map((id) => byId.get(id)!).filter(Boolean), window, stock: sums };
    },
    LIST_READ,
  );

  return { data: rows.map((row) => toSummaryDTO(context, row, stock.get(row.id))), pagination: window };
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
  client: Prisma.TransactionClient = prisma,
): Promise<Map<string, { onHand: Prisma.Decimal; reserved: Prisma.Decimal }>> {
  if (!canSeeStock(context) || itemIds.length === 0) return new Map();

  const rows = await client.inventoryBalance.groupBy({
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

/**
 * Has this item ever moved?
 *
 * The edit form asks so it can lock the base unit before the person types
 * rather than refusing after they save — the rule is the same either way, and
 * the service enforces it regardless (PRD #20 §46).
 */
export async function hasMovements(itemId: string): Promise<boolean> {
  const moved = await prisma.stockMovement.count({
    where: { inventoryItemId: itemId },
    take: 1,
  });
  return moved > 0;
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

  await assertDefaults(context, input.defaultWarehouseId ?? null, input.defaultLocationId ?? null);

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
        // The create default lives here, not in the shared schema (AUD-09 §4).
        status: input.status ?? "ACTIVE",
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
      select: { id: true, sku: true, baseUnit: true, status: true, archivedAt: true, updatedAt: true },
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

  // Absent keeps the saved status: an edit that does not carry it never
  // reactivates an inactive item (AUD-09 §4, FV-05).
  const status = input.status ?? existing.status;
  await assertDefaults(context, input.defaultWarehouseId ?? null, input.defaultLocationId ?? null);

  await prisma.$transaction(async (tx) => {
    await assertSkuIsFree(tx, context, input.sku, itemId);

    const details = {
      sku: input.sku,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      baseUnit: input.baseUnit,
      minimumStock: input.minimumStock === undefined ? null : new Prisma.Decimal(input.minimumStock),
      reorderPoint: input.reorderPoint === undefined ? null : new Prisma.Decimal(input.reorderPoint),
      defaultWarehouseId: input.defaultWarehouseId ?? null,
      defaultLocationId: input.defaultLocationId ?? null,
      updatedByMemberId: context.membershipId,
    };

    // The form carries the status. Changing it switches the item on or off,
    // which is a transition; leaving it alone is an edit, still conditional on
    // the status the form was opened on, so an item archived meanwhile is not
    // quietly edited back to life.
    if (status !== existing.status) {
      await applyTransition(tx, {
        machine: inventoryItemMachine,
        action: status === "ACTIVE" ? "activate" : "deactivate",
        id: itemId,
        context,
        from: existing.status,
        data: details,
      });
    } else {
      const saved = await tx.inventoryItem.updateMany({
        where: { id: itemId, companyId: context.companyId, status: existing.status },
        data: details,
      });
      if (saved.count === 0) {
        throw new AccessError("CONFLICT", "This item changed since you opened it. Reload to see the latest.", {
          code: "INVENTORY_ITEM_STALE",
        });
      }
    }

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
      select: { id: true, sku: true, status: true, archivedAt: true },
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
    const outcome = await applyTransition(tx, {
      machine: inventoryItemMachine,
      action: "archive",
      id: itemId,
      context,
      from: existing.status,
      data: { archivedAt: new Date(), archivedByMemberId: context.membershipId },
      idempotent: true,
    });
    // Archived by somebody else a moment earlier: already done, and theirs is
    // the archive the history records.
    if (outcome === "ALREADY_THERE") return;

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
      select: { id: true, sku: true, status: true, archivedAt: true },
    }),
  );

  if (!existing.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    // Back as INACTIVE: leaving the archive is not the same decision as being
    // ready to move again.
    const outcome = await applyTransition(tx, {
      machine: inventoryItemMachine,
      action: "restore",
      id: itemId,
      context,
      from: existing.status,
      data: { archivedAt: null, archivedByMemberId: null },
      idempotent: true,
    });
    if (outcome === "ALREADY_THERE") return;

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

/**
 * An item's default warehouse and location must be this company's, and the
 * location must sit in that warehouse (AUD-09 §5, FV-09). The columns have no
 * foreign key, so before this a forged id — another company's warehouse, a
 * location of a different warehouse — was stored as given.
 */
async function assertDefaults(context: UserContext, warehouseId: string | null, locationId: string | null): Promise<void> {
  if (warehouseId) {
    const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, companyId: context.companyId }, select: { id: true } });
    if (!warehouse) {
      throw new AccessError("VALIDATION_ERROR", "Choose a warehouse of this company.", {
        code: "INVALID_WAREHOUSE",
        defaultWarehouseId: ["Choose a warehouse of this company."],
      });
    }
  }
  if (locationId && !warehouseId) {
    const message = "Choose a default warehouse for this location first.";
    throw new AccessError("VALIDATION_ERROR", message, { code: "INVALID_LOCATION", defaultLocationId: [message] });
  }
  if (locationId && warehouseId) {
    const location = await prisma.inventoryLocation.findFirst({
      where: { id: locationId, companyId: context.companyId, warehouseId },
      select: { id: true },
    });
    if (!location) {
      const message = "Choose a location in the default warehouse.";
      throw new AccessError("VALIDATION_ERROR", message, { code: "INVALID_LOCATION", defaultLocationId: [message] });
    }
  }
}
