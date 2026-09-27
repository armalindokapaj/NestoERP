import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StockLevelBadge } from "@/components/inventory/stock-level-badge";
import { formatQuantity } from "@/components/inventory/inventory-format";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { canSeeStock } from "@/lib/modules/inventory/inventory.dto";
import * as items from "@/lib/modules/inventory/items/item.service";
import { itemListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import type { ItemSummaryDTO } from "@/lib/modules/inventory/inventory.types";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export const metadata: Metadata = { title: "Low stock" };

/**
 * What is running out (PRD #20 §167–§172, §321).
 *
 * NESTO reports; it does not reorder. There is no automatic replenishment in
 * V0.1 — a low item offers a link into Procurement for somebody to decide,
 * and that link appears only for a reader who may actually raise a request
 * (PRD #20 §171, §172).
 */
export default async function LowStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.low_stock.view") || !canSeeStock(context)) {
    redirect("/access-denied");
  }

  const experience = resolveModuleExperience(context, "inventory");
  const params = await searchParams;
  const page = typeof params.page === "string" ? params.page : undefined;

  const query = itemListQuerySchema.parse({ view: "low-stock", sort: "stock-asc", page });
  const result = await items.listItems(context, query);
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/inventory/low-stock", params, result.pagination.page));

  const mayRequest = can(context, "procurement.request.create");
  const mayReserve = can(context, "inventory.reservation.create");

  const columns: TableColumn<ItemSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: "Item",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <Link
            href={`/inventory/items/${row.id}`}
            className="font-medium text-fg hover:text-accent"
          >
            {row.name}
          </Link>
          <span className="text-meta text-fg-subtle">{row.sku}</span>
        </span>
      ),
    },
    {
      key: "onHand",
      id: "onHand",
      valueType: "number",
      label: "On hand",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {formatQuantity(row.stock?.onHand)} {row.baseUnit}
        </span>
      ),
    },
    {
      key: "available",
      id: "available",
      valueType: "number",
      label: "Available",
      align: "right",
      hideBelow: "md",
      render: (row) => (
        <span className="tabular-nums">{formatQuantity(row.stock?.available)}</span>
      ),
    },
    {
      key: "reorderPoint",
      id: "reorderPoint",
      valueType: "number",
      label: "Reorder at",
      align: "right",
      hideBelow: "lg",
      render: (row) =>
        row.reorderPoint === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="tabular-nums text-fg-muted">{formatQuantity(row.reorderPoint)}</span>
        ),
    },
    {
      key: "minimumStock",
      id: "minimumStock",
      valueType: "number",
      label: "Minimum",
      align: "right",
      hideBelow: "xl",
      render: (row) =>
        row.minimumStock === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="tabular-nums text-fg-muted">{formatQuantity(row.minimumStock)}</span>
        ),
    },
    {
      key: "level",
      id: "level",
      mandatory: true,
      valueType: "status",
      label: "Level",
      render: (row) => <StockLevelBadge level={row.level} />,
    },
  ];

  const buildHref = (next: number) => pageHref("/inventory/low-stock", params, next);

  return (
    <ModulePage
      experience={experience}
      activeSection="low-stock"
      description="Items at or below the thresholds the company set. NESTO reports what is running out; somebody still decides what to do about it."
    >
      {result.data.length === 0 ? (
        <EmptyState
          icon={<PackageCheck />}
          title="Nothing is running low."
          description="Every item with a threshold set is above it. Items with no minimum and no reorder point are never reported here — NESTO does not invent a number the company never chose."
        />
      ) : (
        <div className="space-y-4">
          <DataTable
      listId="inventory.low-stock"
            columns={columns}
            records={result.data}
            rowKey={(row) => row.id}
            caption="Items running low"
            actions={
              mayRequest || mayReserve
                ? (row) => (
                    <div className="flex items-center justify-end gap-1">
                      {mayReserve ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/inventory/reservations/new?itemId=${row.id}`}>
                            Reserve
                          </Link>
                        </Button>
                      ) : null}
                      {mayRequest ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            href={`/procurement/requests/new?title=${encodeURIComponent(row.name)}`}
                          >
                            Request
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  )
                : undefined
            }
          />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </div>
      )}
    </ModulePage>
  );
}
