import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prepareExport, type ExportColumn, type ExportLimits, type PreparedExport } from "@/lib/core/export/exporter";
import { assertApplied, assertExportParams, assertExportRange, type ParamRules } from "@/lib/core/export/export-params";
import { canSeeStock } from "./inventory.dto";
import * as adjustments from "./documents/adjustment.service";
import * as issues from "./documents/issue.service";
import * as items from "./items/item.service";
import * as movements from "./movements/movement.service";
import * as reservations from "./reservations/reservation.service";
import {
  adjustmentReasonLabels,
  itemCategoryLabels,
  itemStatusLabels,
  movementTypeLabels,
  reservationStatusLabels,
  stockLevelLabels,
  transactionStatusLabels,
} from "./inventory.status";
import {
  balanceListQuerySchema,
  itemListQuerySchema,
  movementListQuerySchema,
  reservationListQuerySchema,
  transactionListQuerySchema,
  type BalanceListQuery,
  type ItemListQuery,
  type MovementListQuery,
  type ReservationListQuery,
  type TransactionListQuery,
} from "./inventory.schema";
import type { AdjustmentSummaryDTO, IssueSummaryDTO, ItemSummaryDTO, MovementDTO, ReservationDTO, StockRowDTO } from "./inventory.types";

/**
 * CSV export (PRD #20 §214, §215; AUD-08 §7).
 *
 * The export is the list. It reads the parameters the list page reads,
 * validates them with the list's own schemas and refuses any the list would
 * drop (a stale `sort` quietly becomes the default on a page, not in a file),
 * calls the same service and receives the same scoped, redacted DTOs — so a
 * reader without balance permission gets a file with no stock columns rather
 * than a file with the figures in it, and a project user's file covers only
 * their own warehouses (PRD #20 §215, §391). Every match leaves, in the
 * list's order; past the cap the request is refused whole.
 *
 * Quantities are written exactly as the DTO carries them — decimal strings, in
 * numeric columns, the sign kept on a movement so a column sums to the balance
 * (PRD #20 §71, §272). A SKU is a code: `007` is written `007`.
 *
 * Limits: 10,000 rows, 10 MiB, 30 s. Lines end LF, as this file always has.
 */

export const EXPORT_ROW_CAP = 10_000;
export const INVENTORY_EXPORT_LIMITS: Partial<ExportLimits> = { maxRows: EXPORT_ROW_CAP };
const LAYOUT = { lineBreak: "\n" } as const;

export const INVENTORY_EXPORT_TYPES = ["items", "balances", "movements", "issues", "reservations", "adjustments"] as const;
export type InventoryExportType = (typeof INVENTORY_EXPORT_TYPES)[number];

export type InventoryExportQueries = {
  items?: ItemListQuery;
  balances?: BalanceListQuery;
  movements?: MovementListQuery;
  transactions?: TransactionListQuery;
  reservations?: ReservationListQuery;
};

const TEXT: ParamRules[string] = { kind: "text", max: 400 };
const TRANSACTION_PARAMS: ParamRules = { search: TEXT, status: TEXT, warehouseId: { kind: "id" }, projectId: { kind: "id" }, reason: TEXT, sort: TEXT };

/** Keys each export takes (the list page's own); enumerated values are checked against the list's schema. */
export const INVENTORY_EXPORT_PARAMS: Record<InventoryExportType, ParamRules> = {
  items: { search: TEXT, view: TEXT, status: TEXT, category: TEXT, warehouseId: { kind: "id" }, sort: TEXT },
  balances: { search: TEXT, warehouseId: { kind: "id" }, locationId: { kind: "id" }, inventoryItemId: { kind: "id" }, heldOnly: { kind: "flag" }, sort: TEXT },
  movements: {
    search: TEXT,
    movementType: TEXT,
    warehouseId: { kind: "id" },
    locationId: { kind: "id" },
    inventoryItemId: { kind: "id" },
    projectId: { kind: "id" },
    from: { kind: "date" },
    to: { kind: "date" },
    sort: TEXT,
  },
  issues: TRANSACTION_PARAMS,
  adjustments: TRANSACTION_PARAMS,
  reservations: { search: TEXT, status: TEXT, warehouseId: { kind: "id" }, projectId: { kind: "id" }, inventoryItemId: { kind: "id" }, sort: TEXT },
};

function list(params: URLSearchParams, key: string): string[] | undefined {
  const raw = params.get(key);
  if (!raw) return undefined;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function one(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value : undefined;
}

/** The export's query string → the one list query for `type`, strictly. */
export function parseInventoryExport(context: UserContext, type: InventoryExportType, params: URLSearchParams): InventoryExportQueries {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.export");
  assertExportParams(params, INVENTORY_EXPORT_PARAMS[type], { selector: ["type"] });
  const search = one(params, "search");
  switch (type) {
    case "items": {
      const query = itemListQuerySchema.parse({ search, view: one(params, "view"), status: list(params, "status"), category: list(params, "category"), warehouseId: one(params, "warehouseId"), sort: one(params, "sort") });
      assertApplied(params, query, { view: "view", status: "status", category: "category", sort: "sort" });
      return { items: query };
    }
    case "balances": {
      const query = balanceListQuerySchema.parse({
        search,
        warehouseId: one(params, "warehouseId"),
        locationId: one(params, "locationId"),
        inventoryItemId: one(params, "inventoryItemId"),
        heldOnly: one(params, "heldOnly"),
        sort: one(params, "sort"),
      });
      assertApplied(params, query, { heldOnly: "heldOnly", sort: "sort" });
      return { balances: query };
    }
    case "movements": {
      assertExportRange(params, "from", "to");
      const query = movementListQuerySchema.parse({
        search,
        movementType: list(params, "movementType"),
        warehouseId: one(params, "warehouseId"),
        locationId: one(params, "locationId"),
        inventoryItemId: one(params, "inventoryItemId"),
        projectId: one(params, "projectId"),
        from: one(params, "from"),
        to: one(params, "to"),
        sort: one(params, "sort"),
      });
      assertApplied(params, query, { movementType: "movementType", sort: "sort" });
      return { movements: query };
    }
    case "issues":
    case "adjustments": {
      const query = transactionListQuerySchema.parse({ search, status: list(params, "status"), warehouseId: one(params, "warehouseId"), projectId: one(params, "projectId"), reason: one(params, "reason"), sort: one(params, "sort") });
      assertApplied(params, query, { status: "status", reason: "reason", sort: "sort" });
      return { transactions: query };
    }
    case "reservations": {
      const query = reservationListQuerySchema.parse({ search, status: list(params, "status"), warehouseId: one(params, "warehouseId"), projectId: one(params, "projectId"), inventoryItemId: one(params, "inventoryItemId"), sort: one(params, "sort") });
      assertApplied(params, query, { status: "status", sort: "sort" });
      return { reservations: query };
    }
  }
}

const company = (context: UserContext) => ({ header: "Company ID", kind: "code" as const, value: () => context.companyId });

export function itemColumns(context: UserContext): ExportColumn<ItemSummaryDTO>[] {
  const columns: ExportColumn<ItemSummaryDTO>[] = [
    company(context),
    { header: "Item ID", kind: "code", value: (row) => row.id },
    { header: "SKU", kind: "code", value: (row) => row.sku },
    { header: "Name", kind: "text", value: (row) => row.name },
    { header: "Category", kind: "status", value: (row) => itemCategoryLabels[row.category] },
    { header: "Unit", kind: "code", value: (row) => row.baseUnit },
    { header: "Status", kind: "status", value: (row) => itemStatusLabels[row.status] },
    { header: "Minimum stock", kind: "decimal", value: (row) => row.minimumStock },
    { header: "Reorder point", kind: "decimal", value: (row) => row.reorderPoint },
  ];
  // Stock columns appear only for a reader who may see stock. Writing them
  // empty would imply the figure is zero (PRD #20 §20).
  if (canSeeStock(context)) {
    columns.push(
      { header: "On hand", kind: "decimal", value: (row) => row.stock?.onHand },
      { header: "Reserved", kind: "decimal", value: (row) => row.stock?.reserved },
      { header: "Available", kind: "decimal", value: (row) => row.stock?.available },
      { header: "Level", kind: "status", value: (row) => stockLevelLabels[row.level] },
    );
  }
  return columns;
}

export function balanceColumns(context: UserContext): ExportColumn<StockRowDTO>[] {
  return [
    company(context),
    { header: "Item ID", kind: "code", value: (row) => row.item.id },
    { header: "SKU", kind: "code", value: (row) => row.item.sku },
    { header: "Item", kind: "text", value: (row) => row.item.name },
    { header: "Warehouse", kind: "code", value: (row) => row.warehouse.code },
    { header: "Location", kind: "code", value: (row) => row.location.code },
    { header: "Location ID", kind: "code", value: (row) => row.location.id },
    { header: "Unit", kind: "code", value: (row) => row.item.baseUnit },
    { header: "On hand", kind: "decimal", value: (row) => row.onHand },
    { header: "Reserved", kind: "decimal", value: (row) => row.reserved },
    { header: "Available", kind: "decimal", value: (row) => row.available },
  ];
}

export function movementColumns(context: UserContext): ExportColumn<MovementDTO>[] {
  return [
    company(context),
    { header: "Movement ID", kind: "code", value: (row) => row.id },
    { header: "When", kind: "datetime", value: (row) => row.occurredAt },
    { header: "Type", kind: "status", value: (row) => movementTypeLabels[row.movementType] },
    { header: "SKU", kind: "code", value: (row) => row.item.sku },
    { header: "Item", kind: "text", value: (row) => row.item.name },
    { header: "Warehouse", kind: "code", value: (row) => row.warehouse.code },
    { header: "Location", kind: "code", value: (row) => row.location.code },
    { header: "Project ID", kind: "code", value: (row) => row.project?.id },
    { header: "Project", kind: "code", value: (row) => row.project?.code },
    // Signed, so a spreadsheet sums the column to the balance.
    { header: "Quantity", kind: "decimal", value: (row) => row.signedQuantity },
    { header: "Unit", kind: "code", value: (row) => row.unit },
    { header: "Source", kind: "text", value: (row) => row.source?.label },
    { header: "Posted by", kind: "text", value: (row) => row.postedBy?.fullName },
  ];
}

export function issueColumns(context: UserContext): ExportColumn<IssueSummaryDTO>[] {
  return [
    company(context),
    { header: "Issue ID", kind: "code", value: (row) => row.id },
    { header: "Issue", kind: "code", value: (row) => row.issueNumber },
    { header: "Status", kind: "status", value: (row) => transactionStatusLabels[row.status] },
    { header: "Date", kind: "date", value: (row) => row.issueDate },
    { header: "Warehouse", kind: "code", value: (row) => row.warehouse.code },
    { header: "Project ID", kind: "code", value: (row) => row.project?.id },
    { header: "Project", kind: "code", value: (row) => row.project?.code },
    { header: "Issued to", kind: "text", value: (row) => row.issuedTo?.fullName },
    { header: "Lines", kind: "integer", value: (row) => row.lineCount },
  ];
}

export function adjustmentColumns(context: UserContext): ExportColumn<AdjustmentSummaryDTO>[] {
  return [
    company(context),
    { header: "Adjustment ID", kind: "code", value: (row) => row.id },
    { header: "Adjustment", kind: "code", value: (row) => row.adjustmentNumber },
    { header: "Status", kind: "status", value: (row) => transactionStatusLabels[row.status] },
    { header: "Date", kind: "date", value: (row) => row.adjustmentDate },
    { header: "Warehouse", kind: "code", value: (row) => row.warehouse.code },
    { header: "Reason", kind: "status", value: (row) => adjustmentReasonLabels[row.reason] },
    { header: "Lines", kind: "integer", value: (row) => row.lineCount },
  ];
}

export function reservationColumns(context: UserContext): ExportColumn<ReservationDTO>[] {
  return [
    company(context),
    { header: "Reservation ID", kind: "code", value: (row) => row.id },
    { header: "Reservation", kind: "code", value: (row) => row.reservationNumber },
    { header: "Status", kind: "status", value: (row) => reservationStatusLabels[row.status] },
    { header: "SKU", kind: "code", value: (row) => row.item.sku },
    { header: "Item", kind: "text", value: (row) => row.item.name },
    { header: "Warehouse", kind: "code", value: (row) => row.warehouse.code },
    { header: "Location", kind: "code", value: (row) => row.location.code },
    { header: "Project ID", kind: "code", value: (row) => row.project?.id },
    { header: "Project", kind: "code", value: (row) => row.project?.code },
    { header: "Reserved", kind: "decimal", value: (row) => row.quantity },
    { header: "Fulfilled", kind: "decimal", value: (row) => row.fulfilledQuantity },
    { header: "Remaining", kind: "decimal", value: (row) => row.remainingQuantity },
    { header: "Unit", kind: "code", value: (row) => row.item.baseUnit },
    { header: "Required", kind: "date", value: (row) => row.requiredDate },
    { header: "Expires", kind: "datetime", value: (row) => row.expiresAt },
  ];
}

export async function exportInventory(
  context: UserContext,
  type: InventoryExportType,
  query: InventoryExportQueries,
  options: { evaluatedAt?: Date } = {},
): Promise<PreparedExport> {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.export");

  const evaluatedAt = options.evaluatedAt ?? new Date();
  const stamp = evaluatedAt.toISOString().slice(0, 10);
  const shared = { limits: INVENTORY_EXPORT_LIMITS, layout: LAYOUT, evaluatedAt };
  const page = { page: 1 };

  switch (type) {
    case "items": {
      assertPermission(context, "inventory.item.view");
      const base = query.items ?? itemListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "inventory.items",
        filename: `inventory-items-${stamp}.csv`,
        columns: itemColumns(context),
        read: async (take) => {
          const result = await items.listItems(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "balances": {
      const base = query.balances ?? balanceListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "inventory.balances",
        filename: `inventory-stock-${stamp}.csv`,
        columns: balanceColumns(context),
        read: async (take) => {
          const result = await movements.listBalances(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "movements": {
      const base = query.movements ?? movementListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "inventory.movements",
        filename: `inventory-movements-${stamp}.csv`,
        columns: movementColumns(context),
        read: async (take) => {
          const result = await movements.listMovements(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "issues": {
      assertPermission(context, "inventory.issue.view");
      const base = query.transactions ?? transactionListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "inventory.issues",
        filename: `inventory-issues-${stamp}.csv`,
        columns: issueColumns(context),
        read: async (take) => {
          const result = await issues.listIssues(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "adjustments": {
      assertPermission(context, "inventory.adjustment.view");
      const base = query.transactions ?? transactionListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "inventory.adjustments",
        filename: `inventory-adjustments-${stamp}.csv`,
        columns: adjustmentColumns(context),
        read: async (take) => {
          const result = await adjustments.listAdjustments(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "reservations": {
      assertPermission(context, "inventory.reservation.view");
      const base = query.reservations ?? reservationListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "inventory.reservations",
        filename: `inventory-reservations-${stamp}.csv`,
        columns: reservationColumns(context),
        read: async (take) => {
          const result = await reservations.listReservations(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
  }
}
