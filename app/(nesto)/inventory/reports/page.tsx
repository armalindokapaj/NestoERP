import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { InventoryExportLink } from "@/components/inventory/export-link";
import { ModulePage } from "@/components/modules/module-page";
import { formatQuantity } from "@/components/inventory/inventory-format";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { inventoryReports } from "@/lib/modules/inventory/reports/reports.service";
import {
  adjustmentReasonLabels,
  movementTypeLabels,
} from "@/lib/modules/inventory/inventory.status";
import type {
  ItemRef,
  StockByWarehouseRow,
} from "@/lib/modules/inventory/inventory.types";
import { statusLabel } from "@/lib/utils/status";

export const metadata: Metadata = { title: "Inventory reports" };

/**
 * Built-in inventory reports (PRD #20 §205–§213).
 *
 * Every figure is counted through the reader's own warehouse scope, so a site
 * storeman and a head-office buyer see different totals on this page and both
 * are right (PRD #20 §215, §376).
 *
 * Quantities are only ever summed within one item. Adding bags of cement to
 * tonnes of steel produces a number that means nothing, so the warehouse table
 * reports how many distinct items sit there alongside the raw total
 * (PRD #20 §22).
 */
export default async function InventoryReportsPage() {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "inventory");
  const reports = await inventoryReports(context);

  const warehouseColumns: TableColumn<StockByWarehouseRow>[] = [
    {
      key: "warehouse",
      label: "Warehouse",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <Link
            href={`/inventory/warehouses/${row.warehouse.id}`}
            className="font-medium text-fg hover:text-accent"
          >
            {row.warehouse.name}
          </Link>
          <span className="text-meta text-fg-subtle">{row.warehouse.code}</span>
        </span>
      ),
    },
    {
      key: "distinctItems",
      label: "Distinct items",
      align: "right",
      render: (row) => <span className="tabular-nums">{row.distinctItems}</span>,
    },
    {
      key: "totalReserved",
      label: "Reserved",
      align: "right",
      hideBelow: "md",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{formatQuantity(row.totalReserved)}</span>
      ),
    },
  ];

  // The report only ever returns rows that resolved an item, so the list is
  // narrowed once here rather than every column re-checking for null.
  const heldRows = reports.topHeldItems.filter(
    (row): row is { item: ItemRef; onHand: string; locations: number } => row.item !== null,
  );

  const heldColumns: TableColumn<{ item: ItemRef; onHand: string; locations: number }>[] = [
    {
      key: "item",
      label: "Item",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <Link
            href={`/inventory/items/${row.item.id}`}
            className="font-medium text-fg hover:text-accent"
          >
            {row.item.name}
          </Link>
          <span className="text-meta text-fg-subtle">{row.item.sku}</span>
        </span>
      ),
    },
    {
      key: "onHand",
      label: "On hand",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {formatQuantity(row.onHand)} {row.item.baseUnit}
        </span>
      ),
    },
    {
      key: "locations",
      label: "Locations",
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums">{row.locations}</span>,
    },
  ];

  return (
    <ModulePage
      experience={experience}
      activeSection="reports"
      description="Counted through your own access. Two people on this page can see different totals, and both are right."
      actions={
        can(context, "inventory.export") ? (
          <InventoryExportLink type="balances" label="Export stock" />
        ) : null
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <div>
            <h2 className="text-card font-semibold text-fg">Stock by warehouse</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              How many distinct items each warehouse is holding. There is no single quantity
              total across a warehouse — bags and tonnes do not add up.
            </p>
          </div>
          {reports.stockByWarehouse.length === 0 ? (
            <p className="nesto-card p-5 text-table text-fg-subtle">
              No warehouses are visible to you.
            </p>
          ) : (
            <DataTable
              columns={warehouseColumns}
              records={reports.stockByWarehouse}
              rowKey={(row) => row.warehouse.id}
              caption="Stock by warehouse"
            />
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-card font-semibold text-fg">Most held items</h2>
            <p className="mt-1 text-meta text-fg-subtle">
              Summed within each item, across every location you can see.
            </p>
          </div>
          {heldRows.length === 0 ? (
            <p className="nesto-card p-5 text-table text-fg-subtle">
              Nothing is recorded as held.
            </p>
          ) : (
            <DataTable
              columns={heldColumns}
              records={heldRows}
              rowKey={(row) => row.item.id}
              caption="Most held items"
            />
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <CountPanel
            title="Movements by type"
            emptyLabel="No movements are visible to you."
            rows={reports.movementsByType.map((row) => ({
              key: row.movementType,
              label:
                movementTypeLabels[row.movementType as keyof typeof movementTypeLabels] ??
                statusLabel(row.movementType),
              count: row.count,
            }))}
          />

          <CountPanel
            title="Adjustments by reason"
            emptyLabel="No posted adjustments are visible to you."
            rows={reports.adjustmentsByReason.map((row) => ({
              key: row.reason,
              label:
                adjustmentReasonLabels[row.reason as keyof typeof adjustmentReasonLabels] ??
                statusLabel(row.reason),
              count: row.count,
            }))}
          />
        </div>

        <p className="text-meta text-fg-subtle">
          There is no stock value here. V0.1 has no costing method, so a currency figure would be
          a number nobody could defend.
        </p>
      </div>
    </ModulePage>
  );
}

function CountPanel({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: { key: string; label: string; count: number }[];
  emptyLabel: string;
}) {
  const total = rows.reduce((running, row) => running + row.count, 0);

  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <dl className="mt-4 space-y-2.5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3">
              <dt className="text-table text-fg-muted">{row.label}</dt>
              <dd className="text-table font-medium tabular-nums text-fg">{row.count}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5">
            <dt className="text-table font-medium text-fg">Total</dt>
            <dd className="text-table font-semibold tabular-nums text-fg">{total}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
