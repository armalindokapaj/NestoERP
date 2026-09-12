import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Factory } from "lucide-react";

import { SupplierTable } from "@/components/procurement/supplier-table";
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
import * as suppliers from "@/lib/modules/procurement/suppliers/supplier.service";
import { supplierListQuerySchema } from "@/lib/modules/procurement/procurement.schema";
import {
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  supplierStatusLabels,
  supplierTypeLabels,
} from "@/lib/modules/procurement/procurement.status";

export const metadata: Metadata = { title: "Suppliers" };

type SearchParams = Record<string, string | string[] | undefined>;

/** The supplier directory (PRD #19 §32–§35). */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.supplier.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "procurement");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="suppliers"
      actions={
        can(context, "procurement.supplier.create") ? (
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

  const query = supplierListQuerySchema.parse({
    search: read("search"),
    status: statuses?.length ? statuses : undefined,
    supplierType: types?.length ? types : undefined,
    country: read("country"),
    sort: read("sort"),
    page: read("page"),
  });

  const [result, options] = await Promise.all([
    suppliers.listSuppliers(context, query),
    suppliers.supplierFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search || query.status?.length || query.supplierType?.length || query.country,
  );

  const filters: FilterConfig[] = [
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
            description="A supplier is who the company buys from — separate from a client, who is who it sells to."
            action={
              can(context, "procurement.supplier.create")
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
