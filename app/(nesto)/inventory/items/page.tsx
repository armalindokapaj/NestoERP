import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";

import { InventoryExportLink } from "@/components/inventory/export-link";
import { ItemTable } from "@/components/inventory/item-table";
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
import { canSeeStock } from "@/lib/modules/inventory/inventory.dto";
import * as items from "@/lib/modules/inventory/items/item.service";
import { itemListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import {
  ITEM_CATEGORIES,
  ITEM_STATUSES,
  itemCategoryLabels,
  itemStatusLabels,
} from "@/lib/modules/inventory/inventory.status";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { inventoryLabel } from "@/components/inventory/inventory-labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.inventoryItems") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** The item master (PRD #20 §39–§41). */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.item.view")) redirect("/access-denied");

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
      activeSection="items"
      actions={
        <>
          {can(context, "inventory.export") ? (
            <InventoryExportLink type="items" search={query} />
          ) : null}
          {can(context, "inventory.item.create") ? (
            <Button asChild size="sm">
              <Link href="/inventory/items/new">{t("meta.newItem")}</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <ItemList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function ItemList({
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
    .filter((value) => (ITEM_STATUSES as readonly string[]).includes(value));
  const categories = read("category")
    ?.split(",")
    .filter((value) => (ITEM_CATEGORIES as readonly string[]).includes(value));

  const query = itemListQuerySchema.parse({
    search: read("search"),
    view: read("view"),
    status: statuses?.length ? statuses : undefined,
    category: categories?.length ? categories : undefined,
    warehouseId: read("warehouseId"),
    sort: read("sort"),
    page: read("page"),
  });

  const [result, options] = await Promise.all([
    items.listItems(context, query),
    items.itemFilterOptions(context),
  ]);

  const showStock = canSeeStock(context);
  const hasFilters = Boolean(
    query.search ||
      query.status?.length ||
      query.category?.length ||
      query.warehouseId ||
      query.view !== "all",
  );

  const filters: FilterConfig[] = [
    {
      param: "view",
      label: t("items.view"),
      options: [
        { value: "all", label: t("items.allItems") },
        { value: "low-stock", label: t("meta.lowStock") },
        { value: "archived", label: t("labels.itemStatus.ARCHIVED") },
      ],
    },
    {
      param: "status",
      label: t("columns.status"),
      options: ITEM_STATUSES.map((value) => ({ value, label: inventoryLabel(t, "itemStatus", value, itemStatusLabels[value]) })),
    },
    {
      param: "category",
      label: t("columns.category"),
      options: ITEM_CATEGORIES.map((value) => ({ value, label: inventoryLabel(t, "itemCategory", value, itemCategoryLabels[value]) })),
    },
    ...(options.warehouses.length > 1
      ? [
          {
            param: "warehouseId",
            label: t("columns.warehouse"),
            options: options.warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: `${warehouse.code} — ${warehouse.name}`,
            })),
          },
        ]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/inventory/items", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/inventory/items", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("items.search")}
        filters={filters}
        sortOptions={[
          { value: "name-asc", label: t("sort.nameAz") },
          { value: "sku-asc", label: t("fields.sku") },
          { value: "stock-asc", label: t("sort.leastStock") },
          { value: "updated-desc", label: t("sort.recentlyUpdated") },
          { value: "created-desc", label: t("sort.recentlyAdded") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Package />}
            title={t("items.noMatch")}
            description={t("empty.noMatchDescription")}
            action={{ label: t("empty.clearFilters"), href: "/inventory/items" }}
          />
        ) : (
          <EmptyState
            icon={<Package />}
            title={t("items.emptyTitle")}
            description={t("items.emptyDescription")}
            action={
              can(context, "inventory.item.create")
                ? { label: t("meta.newItem"), href: "/inventory/items/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <ItemTable items={result.data} showStock={showStock} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
