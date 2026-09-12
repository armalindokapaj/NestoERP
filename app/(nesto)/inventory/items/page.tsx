import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
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

export const metadata: Metadata = { title: "Inventory items" };

type SearchParams = Record<string, string | string[] | undefined>;

/** The item master (PRD #20 §39–§41). */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.item.view")) redirect("/access-denied");

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
              <Link href="/inventory/items/new">New item</Link>
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
      label: "View",
      options: [
        { value: "all", label: "All items" },
        { value: "low-stock", label: "Low stock" },
        { value: "archived", label: "Archived" },
      ],
    },
    {
      param: "status",
      label: "Status",
      options: ITEM_STATUSES.map((value) => ({ value, label: itemStatusLabels[value] })),
    },
    {
      param: "category",
      label: "Category",
      options: ITEM_CATEGORIES.map((value) => ({ value, label: itemCategoryLabels[value] })),
    },
    ...(options.warehouses.length > 1
      ? [
          {
            param: "warehouseId",
            label: "Warehouse",
            options: options.warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: `${warehouse.code} — ${warehouse.name}`,
            })),
          },
        ]
      : []),
  ];

  function buildHref(page: number) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") next.set(key, value);
    }
    if (page > 1) next.set("page", String(page));
    const search = next.toString();
    return search ? `/inventory/items?${search}` : "/inventory/items";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search SKU or name…"
        filters={filters}
        sortOptions={[
          { value: "name-asc", label: "Name A–Z" },
          { value: "sku-asc", label: "SKU" },
          { value: "stock-asc", label: "Least stock first" },
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently added" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Package />}
            title="No items match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/inventory/items" }}
          />
        ) : (
          <EmptyState
            icon={<Package />}
            title="No items yet."
            description="An item is something the company stocks — one row here, however many warehouses hold it."
            action={
              can(context, "inventory.item.create")
                ? { label: "New item", href: "/inventory/items/new" }
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
