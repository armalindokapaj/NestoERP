import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { Package } from "lucide-react";

import { StockTable } from "@/components/inventory/stock-table";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import { balanceListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import { WarehousePageShell, loadWarehousePage } from "../warehouse-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.stock") };
}

type Params = {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** What one warehouse is holding (PRD #20 §181). */
export default async function WarehouseStockPage({ params, searchParams }: Params) {
  const { warehouseId } = await params;
  const { context, warehouse } = await loadWarehousePage(warehouseId, "stock");
  const t = await getTranslations("inventory");
  const query = await searchParams;

  const result = await movements.listBalances(
    context,
    balanceListQuerySchema.parse({
      warehouseId,
      search: typeof query.search === "string" ? query.search : undefined,
      page: typeof query.page === "string" ? query.page : undefined,
    }),
  );

  function buildHref(page: number) {
    return page > 1
      ? `/inventory/warehouses/${warehouseId}/stock?page=${page}`
      : `/inventory/warehouses/${warehouseId}/stock`;
  }

  return (
    <WarehousePageShell warehouse={warehouse} tab="stock">
      {result.data.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title={t("detail.nothingOnHand")}
          description={t("detail.warehouseStockEmpty")}
        />
      ) : (
        <div className="space-y-4">
          <StockTable
            rows={result.data}
            show="by-location"
            caption={t("detail.stockIn", { name: warehouse.name })}
            listId="inventory.warehouse-stock"
          />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </div>
      )}
    </WarehousePageShell>
  );
}
