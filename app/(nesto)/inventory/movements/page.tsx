import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { History } from "lucide-react";

import { InventoryExportLink } from "@/components/inventory/export-link";
import { MovementTable } from "@/components/inventory/movement-table";
import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";
import { MOVEMENT_SORT_KEYS, movementListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import {
  MOVEMENT_TYPES,
  movementTypeLabels,
} from "@/lib/modules/inventory/inventory.status";
import { inventoryLabel } from "@/components/inventory/inventory-labels";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.stockMovements") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The stock ledger (PRD #20 §173–§177, §320).
 *
 * Append-only and read-only: a movement is never edited or deleted, so this
 * page carries no controls at all. It is the source of truth that every balance
 * on every other page is a projection of (PRD #20 §67, §79).
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.movement.view")) redirect("/access-denied");

  const t = await getTranslations("inventory");
  const experience = resolveModuleExperience(context, "inventory");
  const params = await searchParams;
  const query = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString();

  return (
    <ModulePage
      experience={experience}
      activeSection="movements"
      description={t("movements.description")}
      actions={
        can(context, "inventory.export") ? (
          <InventoryExportLink type="movements" search={query} />
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={12} />}>
        <MovementList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function MovementList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const t = await getTranslations("inventory");
  const read = (key: string) =>
    typeof searchParams[key] === "string" ? (searchParams[key] as string) : undefined;

  const types = read("movementType")
    ?.split(",")
    .filter((value) => (MOVEMENT_TYPES as readonly string[]).includes(value));

  const query = movementListQuerySchema.parse({
    search: read("search"),
    movementType: types?.length ? types : undefined,
    warehouseId: read("warehouseId"),
    inventoryItemId: read("inventoryItemId"),
    projectId: read("projectId"),
    from: read("from"),
    to: read("to"),
    sort: read("sort"),
    page: read("page"),
  });

  const [result, warehouseOptions] = await Promise.all([
    movements.listMovements(context, query),
    warehouses.selectableWarehouses(context),
  ]);

  const hasFilters = Boolean(
    query.search ||
      query.movementType?.length ||
      query.warehouseId ||
      query.projectId ||
      query.from ||
      query.to,
  );

  const filters: FilterConfig[] = [
    {
      param: "movementType",
      label: t("columns.type"),
      options: MOVEMENT_TYPES.map((value) => ({ value, label: inventoryLabel(t, "movementType", value, movementTypeLabels[value]) })),
    },
    ...(warehouseOptions.length > 1
      ? [{ param: "warehouseId", label: t("columns.warehouse"), options: warehouseOptions }]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/inventory/movements", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/inventory/movements", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("movements.search")}
        filters={filters}
        sortOptions={[
          { value: "occurred-desc", label: t("sort.newest") },
          { value: "occurred-asc", label: t("sort.oldest") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<History />}
            title={t("movements.noMatch")}
            description={t("empty.noMatchDescription")}
            action={{ label: t("empty.clearFilters"), href: "/inventory/movements" }}
          />
        ) : (
          <EmptyState
            icon={<History />}
            title={t("movements.emptyTitle")}
            description={t("movements.emptyDescription")}
          />
        )
      ) : (
        <>
          <MovementTable movements={result.data} sort={{ value: query.sort, keys: MOVEMENT_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
