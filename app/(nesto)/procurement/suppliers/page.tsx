import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Factory } from "lucide-react";

import { SupplierTable } from "@/components/procurement/supplier-table";
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
import * as suppliers from "@/lib/modules/procurement/suppliers/supplier.service";
import { supplierListQuerySchema } from "@/lib/modules/procurement/procurement.schema";
import {
  canReadProcurement,
  resolveProcurementExperience,
} from "@/lib/modules/procurement/procurement.workspace";
import {
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  supplierStatusLabels,
  supplierTypeLabels,
} from "@/lib/modules/procurement/procurement.status";

export const metadata: Metadata = { title: "Suppliers" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The supplier directory (PRD #19 §32–§35).
 *
 * In the Group workspace it lists the suppliers of every company the reader may
 * read them in. A supplier is a company's own record, so the same legal entity
 * known to two companies appears twice, once under each, and is never merged
 * (Workspace Context §38, §45). A new supplier needs a company, so the control
 * is not offered there.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("procurement");
  if (!(await canReadProcurement(context, "procurement.supplier.view"))) redirect("/access-denied");

  const experience = await resolveProcurementExperience(context);
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="suppliers"
      actions={
        !inGroupWorkspace(context) && can(context, "procurement.supplier.create") ? (
          <Button asChild size="sm">
            <Link href="/procurement/suppliers/new">New supplier</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <SupplierList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function SupplierList({
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
    .filter((value) => (SUPPLIER_STATUSES as readonly string[]).includes(value));
  const types = read("type")
    ?.split(",")
    .filter((value) => (SUPPLIER_TYPES as readonly string[]).includes(value));

  const group = inGroupWorkspace(context);

  const query = supplierListQuerySchema.parse({
    // The Group `company` filter; a company workspace never reads it (§86, §87).
    companyId: group ? read("company") : undefined,
    search: read("search"),
    status: statuses?.length ? statuses : undefined,
    supplierType: types?.length ? types : undefined,
    country: read("country"),
    sort: read("sort"),
    page: read("page"),
  });

  const [result, options] = await Promise.all([
    suppliers.listSuppliersForWorkspace(context, query),
    suppliers.supplierFilterOptionsForWorkspace(context),
  ]);

  const hasFilters = Boolean(
    query.companyId ||
      query.search ||
      query.status?.length ||
      query.supplierType?.length ||
      query.country,
  );

  const filters: FilterConfig[] = [
    ...(group && options.companies.length > 1
      ? [{ param: "company", label: "Company", options: options.companies }]
      : []),
    {
      param: "status",
      label: "Status",
      options: SUPPLIER_STATUSES.map((value) => ({
        value,
        label: supplierStatusLabels[value],
      })),
    },
    {
      param: "type",
      label: "Type",
      options: SUPPLIER_TYPES.map((value) => ({ value, label: supplierTypeLabels[value] })),
    },
    ...(options.countries.length > 1
      ? [
          {
            param: "country",
            label: "Country",
            options: options.countries.map((country) => ({ value: country, label: country })),
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
    return search ? `/procurement/suppliers?${search}` : "/procurement/suppliers";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search name, code or tax number…"
        filters={filters}
        sortOptions={[
          { value: "name-asc", label: "Name A–Z" },
          { value: "name-desc", label: "Name Z–A" },
          { value: "code-asc", label: "Supplier code" },
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently added" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Factory />}
            title="No suppliers match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/procurement/suppliers" }}
          />
        ) : (
          <EmptyState
            icon={<Factory />}
            title="No suppliers yet."
            description={
              group
                ? "No company you can read has a supplier yet. Adding one is done inside a company."
                : "A supplier is who the company buys from — separate from a client, who is who it sells to."
            }
            action={
              !group && can(context, "procurement.supplier.create")
                ? { label: "New supplier", href: "/procurement/suppliers/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <SupplierTable suppliers={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
