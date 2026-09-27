import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Warehouse } from "lucide-react";

import { WarehouseTable } from "@/components/inventory/warehouse-table";
import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";
import { warehouseListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import {
  WAREHOUSE_STATUSES,
  WAREHOUSE_TYPES,
  warehouseStatusLabels,
  warehouseTypeLabels,
} from "@/lib/modules/inventory/inventory.status";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { inventoryLabel } from "@/components/inventory/inventory-labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.warehouses") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Where stock is kept (PRD #20 §56–§58). */
export default async function WarehousesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.warehouse.view")) redirect("/access-denied");

  const t = await getTranslations("inventory");
  const experience = resolveModuleExperience(context, "inventory");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="warehouses"
      actions={
        can(context, "inventory.warehouse.create") ? (
          <Button asChild size="sm">
            <Link href="/inventory/warehouses/new">{t("meta.newWarehouse")}</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={6} />}>
        <WarehouseList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function WarehouseList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const t = await getTranslations("inventory");
  const read = (key: string) =>
    typeof searchParams[key] === "string" ? (searchParams[key] as string) : undefined;

  const statuses = read("status")
    ?.split(",")
    .filter((value) => (WAREHOUSE_STATUSES as readonly string[]).includes(value));
  const types = read("type")
    ?.split(",")
    .filter((value) => (WAREHOUSE_TYPES as readonly string[]).includes(value));

  const query = warehouseListQuerySchema.parse({
    search: read("search"),
    status: statuses?.length ? statuses : undefined,
    warehouseType: types?.length ? types : undefined,
    projectId: read("projectId"),
    sort: read("sort"),
    page: read("page"),
  });

  const [result, options] = await Promise.all([
    warehouses.listWarehouses(context, query),
    warehouses.warehouseFormOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search || query.status?.length || query.warehouseType?.length || query.projectId,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: t("columns.status"),
      options: WAREHOUSE_STATUSES.map((value) => ({
        value,
        label: inventoryLabel(t, "warehouseStatus", value, warehouseStatusLabels[value]),
      })),
    },
    {
      param: "type",
      label: t("columns.type"),
      options: WAREHOUSE_TYPES.map((value) => ({ value, label: inventoryLabel(t, "warehouseType", value, warehouseTypeLabels[value]) })),
    },
    ...(options.projects.length > 1
      ? [
          {
            param: "projectId",
            label: t("columns.project"),
            options: options.projects.map((project) => ({
              value: project.id,
              label: `${project.code} — ${project.name}`,
            })),
          },
        ]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/inventory/warehouses", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/inventory/warehouses", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("warehouses.search")}
        filters={filters}
        sortOptions={[
          { value: "code-asc", label: t("fields.code") },
          { value: "name-asc", label: t("sort.nameAz") },
          { value: "updated-desc", label: t("sort.recentlyUpdated") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Warehouse />}
            title={t("warehouses.noMatch")}
            description={t("empty.noMatchDescription")}
            action={{ label: t("empty.clearFilters"), href: "/inventory/warehouses" }}
          />
        ) : (
          <EmptyState
            icon={<Warehouse />}
            title={t("warehouses.emptyTitle")}
            description={t("warehouses.emptyDescription")}
            action={
              can(context, "inventory.warehouse.create")
                ? { label: t("meta.newWarehouse"), href: "/inventory/warehouses/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <WarehouseTable warehouses={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
