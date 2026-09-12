import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";

import { OrderTable } from "@/components/procurement/order-table";
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
import * as orders from "@/lib/modules/procurement/orders/order.service";
import { orderListQuerySchema } from "@/lib/modules/procurement/procurement.schema";
import { ORDER_STATUSES, orderStatusLabels } from "@/lib/modules/procurement/procurement.status";

export const metadata: Metadata = { title: "Purchase orders" };

type SearchParams = Record<string, string | string[] | undefined>;

/** The purchase order register (PRD #19 §254, §255). */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.order.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "procurement");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="orders"
      actions={
        can(context, "procurement.order.create") ? (
          <Button asChild size="sm">
            <Link href="/procurement/orders/new">New order</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <OrderList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function OrderList({
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
    .filter((value) => (ORDER_STATUSES as readonly string[]).includes(value));

  const query = orderListQuerySchema.parse({
    search: read("search"),
    view: read("view") ?? "all",
    status: statuses?.length ? statuses : undefined,
    supplierId: read("supplierId"),
    projectId: read("projectId"),
    currency: read("currency"),
    sort: read("sort"),
    page: read("page"),
  });

  const [result, options] = await Promise.all([
    orders.listOrders(context, query),
    orders.orderFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search || query.status?.length || query.supplierId || query.projectId || query.currency,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: ORDER_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
        value,
        label: orderStatusLabels[value],
      })),
    },
    ...(options.suppliers.length > 0
      ? [
          {
            param: "supplierId",
            label: "Supplier",
            options: options.suppliers.map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            })),
          },
        ]
      : []),
    ...(options.projects.length > 0
      ? [
          {
            param: "projectId",
            label: "Project",
            options: options.projects.map((project) => ({
              value: project.id,
              label: `${project.code} — ${project.name}`,
            })),
          },
        ]
      : []),
    ...(options.currencies.length > 1
      ? [
          {
            param: "currency",
            label: "Currency",
            options: options.currencies.map((code) => ({ value: code, label: code })),
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
    return search ? `/procurement/orders?${search}` : "/procurement/orders";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search order number, supplier or line…"
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "order-desc", label: "Order date" },
          { value: "number-asc", label: "Order number" },
          { value: "required-asc", label: "Due soonest" },
          { value: "value-desc", label: "Value high–low" },
          { value: "status-asc", label: "Status" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<PackageCheck />}
            title="No orders match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/procurement/orders" }}
          />
        ) : (
          <EmptyState
            icon={<PackageCheck />}
            title="No purchase orders yet."
            description="An order is the commitment: issuing one is the moment the company owes a supplier money."
            action={
              can(context, "procurement.order.create")
                ? { label: "New order", href: "/procurement/orders/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <OrderTable orders={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
