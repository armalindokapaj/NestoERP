import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
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
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.suppliers") };
}

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
  const t = await getTranslations("procurement");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="suppliers"
      actions={
        !inGroupWorkspace(context) && can(context, "procurement.supplier.create") ? (
          <Button asChild size="sm">
            <Link href="/procurement/suppliers/new">{t("suppliers.newSupplier")}</Link>
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
  const t = await getTranslations("procurement");

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
      ? [{ param: "company", label: t("common.company"), options: options.companies }]
      : []),
    {
      param: "status",
      label: t("common.status"),
      options: SUPPLIER_STATUSES.map((value) => ({
        value,
        label: procurementLabel(t, "supplierStatus", value, supplierStatusLabels[value]),
      })),
    },
    {
      param: "type",
      label: t("common.type"),
      options: SUPPLIER_TYPES.map((value) => ({ value, label: procurementLabel(t, "supplierType", value, supplierTypeLabels[value]) })),
    },
    ...(options.countries.length > 1
      ? [
          {
            param: "country",
            label: t("common.country"),
            options: options.countries.map((country) => ({ value: country, label: country })),
          },
        ]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/procurement/suppliers", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/procurement/suppliers", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("suppliers.searchPlaceholder")}
        filters={filters}
        sortOptions={[
          { value: "name-asc", label: t("suppliers.sortNameAsc") },
          { value: "name-desc", label: t("suppliers.sortNameDesc") },
          { value: "code-asc", label: t("suppliers.sortCode") },
          { value: "updated-desc", label: t("common.recentlyUpdated") },
          { value: "created-desc", label: t("suppliers.sortAdded") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Factory />}
            title={t("suppliers.noMatch")}
            description={t("common.adjustFilters")}
            action={{ label: t("common.clearFilters"), href: "/procurement/suppliers" }}
          />
        ) : (
          <EmptyState
            icon={<Factory />}
            title={t("suppliers.empty")}
            description={
              group
                ? t("suppliers.emptyGroup")
                : t("suppliers.emptyCompany")
            }
            action={
              !group && can(context, "procurement.supplier.create")
                ? { label: t("suppliers.newSupplier"), href: "/procurement/suppliers/new" }
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
