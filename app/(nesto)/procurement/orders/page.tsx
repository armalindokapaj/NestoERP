import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";

import { OrderTable } from "@/components/procurement/order-table";
import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import { orderListQuerySchema } from "@/lib/modules/procurement/procurement.schema";
import {
  canReadProcurement,
  resolveProcurementExperience,
} from "@/lib/modules/procurement/procurement.workspace";
import { ORDER_STATUSES, orderStatusLabels } from "@/lib/modules/procurement/procurement.status";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export const metadata: Metadata = { title: "Purchase orders" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The purchase order register (PRD #19 §254, §255).
 *
 * In the Group workspace it lists the orders of every company the reader may
 * read them in, each labelled with its company and valued in its own currency
 * (Workspace Context §38, §45, §72); a new order needs a company, so the
 * control is not offered there.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("procurement");
  if (!(await canReadProcurement(context, "procurement.order.view"))) redirect("/access-denied");

  const experience = await resolveProcurementExperience(context);
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="orders"
      actions={
        !inGroupWorkspace(context) && can(context, "procurement.order.create") ? (
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

  const group = inGroupWorkspace(context);

  const query = orderListQuerySchema.parse({
    // The Group `company` filter; a company workspace never reads it (§86, §87).
    companyId: group ? read("company") : undefined,
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
    orders.listOrdersForWorkspace(context, query),
    orders.orderFilterOptionsForWorkspace(context),
  ]);

  const hasFilters = Boolean(
    query.companyId ||
      query.search ||
      query.status?.length ||
      query.supplierId ||
      query.projectId ||
      query.currency,
  );

  const filters: FilterConfig[] = [
    ...(group && options.companies.length > 1
      ? [{ param: "company", label: "Company", options: options.companies }]
      : []),
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
              label: supplier.company ? `${supplier.name} · ${supplier.company.name}` : supplier.name,
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
              label: `${project.code} — ${project.name}${project.company ? ` · ${project.company.name}` : ""}`,
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

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/procurement/orders", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/procurement/orders", searchParams, page);

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
            description={
              group
                ? "No company you can read has a purchase order yet. Raising one is done inside a company."
                : "An order is the commitment: issuing one is the moment the company owes a supplier money."
            }
            action={
              !group && can(context, "procurement.order.create")
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
