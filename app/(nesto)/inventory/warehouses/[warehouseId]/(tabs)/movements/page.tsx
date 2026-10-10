import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { History } from "lucide-react";

import { MovementTable } from "@/components/inventory/movement-table";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import { movementListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import { loadWarehousePage } from "../../warehouse-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.movements") };
}

type Params = {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Everything that has moved through one warehouse (PRD #20 §173). */
export default async function WarehouseMovementsPage({ params, searchParams }: Params) {
  const { warehouseId } = await params;
  const { context, warehouse } = await loadWarehousePage(warehouseId, "movements");
  const t = await getTranslations("inventory");
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
    <>
      {result.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={t("detail.nothingMovedHere")}
          description={t("detail.warehouseMovementsEmpty")}
        />
      ) : (
        <div className="space-y-4">
          <MovementTable
            movements={result.data}
            caption={t("detail.movementsThrough", { name: warehouse.name })}
            listId="inventory.warehouse-movements"
          />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </div>
      )}
    </>
  );
}
