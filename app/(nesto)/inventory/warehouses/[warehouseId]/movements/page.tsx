import type { Metadata } from "next";
import { History } from "lucide-react";

import { MovementTable } from "@/components/inventory/movement-table";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import { movementListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import { WarehousePageShell, loadWarehousePage } from "../warehouse-shell";

export const metadata: Metadata = { title: "Movements" };

type Params = {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Everything that has moved through one warehouse (PRD #20 §173). */
export default async function WarehouseMovementsPage({ params, searchParams }: Params) {
  const { warehouseId } = await params;
  const { context, warehouse } = await loadWarehousePage(warehouseId, "movements");
  const query = await searchParams;

  const result = await movements.listMovements(
    context,
    movementListQuerySchema.parse({
      warehouseId,
      page: typeof query.page === "string" ? query.page : undefined,
    }),
  );

  function buildHref(page: number) {
    return page > 1
      ? `/inventory/warehouses/${warehouseId}/movements?page=${page}`
      : `/inventory/warehouses/${warehouseId}/movements`;
  }

  return (
    <WarehousePageShell warehouse={warehouse} tab="movements">
      {result.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Nothing has moved here."
          description="Receipts, issues, transfers and adjustments touching this warehouse appear here, in order."
        />
      ) : (
        <div className="space-y-4">
          <MovementTable
            movements={result.data}
            caption={`Movements through ${warehouse.name}`}
            listId="inventory.warehouse-movements"
          />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </div>
      )}
    </WarehousePageShell>
  );
}
