import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";

import { RequestTable } from "@/components/procurement/request-table";
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
import * as requests from "@/lib/modules/procurement/requests/request.service";
import { requestListQuerySchema } from "@/lib/modules/procurement/procurement.schema";
import {
  canReadProcurement,
  resolveProcurementExperience,
} from "@/lib/modules/procurement/procurement.workspace";
import {
  CATEGORIES,
  PRIORITIES,
  REQUEST_STATUSES,
  categoryLabels,
  priorityLabels,
  requestStatusLabels,
} from "@/lib/modules/procurement/procurement.status";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { procurementLabel } from "@/lib/i18n/modules/procurement/labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("procurement");
  return { title: t("meta.requests") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The purchase request register (PRD #19 §249–§251).
 *
 * In the Group workspace it lists the requests of every company the reader may
 * read them in, each labelled with its company (Workspace Context §38, §45); a
 * new request needs a company, so the control is not offered there.
 */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("procurement");
  if (!(await canReadProcurement(context, "procurement.request.view"))) redirect("/access-denied");

  const experience = await resolveProcurementExperience(context);
  const t = await getTranslations("procurement");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="requests"
      actions={
        !inGroupWorkspace(context) && can(context, "procurement.request.create") ? (
          <Button asChild size="sm">
            <Link href="/procurement/requests/new">{t("requests.newRequest")}</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <RequestList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function RequestList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const read = (key: string) =>
    typeof searchParams[key] === "string" ? (searchParams[key] as string) : undefined;

  const list = (key: string, allowed: readonly string[]) => {
    const raw = read(key);
    if (!raw) return undefined;
    const values = raw.split(",").filter((value) => allowed.includes(value));
    return values.length > 0 ? values : undefined;
  };

  const group = inGroupWorkspace(context);
  const t = await getTranslations("procurement");

  const query = requestListQuerySchema.parse({
    // The Group `company` filter; a company workspace never reads it (§86, §87).
    companyId: group ? read("company") : undefined,
    search: read("search"),
    view: read("view") ?? "all",
    status: list("status", REQUEST_STATUSES),
    priority: list("priority", PRIORITIES),
    category: list("category", CATEGORIES),
    projectId: read("projectId"),
    departmentId: read("departmentId"),
    requestedByMemberId: read("requestedBy"),
    sort: read("sort"),
    page: read("page"),
  });

  const [result, options] = await Promise.all([
    requests.listRequestsForWorkspace(context, query),
    requests.requestFilterOptionsForWorkspace(context),
  ]);

  const hasFilters = Boolean(
    query.companyId ||
      query.search ||
      query.status?.length ||
      query.priority?.length ||
      query.category?.length ||
      query.projectId ||
      query.departmentId ||
      query.requestedByMemberId,
  );

  const filters: FilterConfig[] = [
    ...(group && options.companies.length > 1
      ? [{ param: "company", label: t("common.company"), options: options.companies }]
      : []),
    {
      param: "status",
      label: t("common.status"),
      options: REQUEST_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
        value,
        label: procurementLabel(t, "requestStatus", value, requestStatusLabels[value]),
      })),
    },
    {
      param: "priority",
      label: t("common.priority"),
      options: PRIORITIES.map((value) => ({ value, label: procurementLabel(t, "priority", value, priorityLabels[value]) })),
    },
    {
      param: "category",
      label: t("common.category"),
      options: CATEGORIES.map((value) => ({ value, label: procurementLabel(t, "category", value, categoryLabels[value]) })),
    },
    ...(options.projects.length > 0
      ? [
          {
            param: "projectId",
            label: t("common.project"),
            options: options.projects.map((project) => ({
              value: project.id,
              label: `${project.code} — ${project.name}${project.company ? ` · ${project.company.name}` : ""}`,
            })),
          },
        ]
      : []),
    ...(options.requesters.length > 1
      ? [
          {
            param: "requestedBy",
            label: t("common.raisedBy"),
            options: options.requesters.map((member) => ({
              value: member.id,
              label: `${member.user.firstName} ${member.user.lastName}${member.company ? ` · ${member.company.name}` : ""}`,
            })),
          },
        ]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/procurement/requests", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/procurement/requests", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("requests.searchPlaceholder")}
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: t("common.recentlyUpdated") },
          { value: "created-desc", label: t("common.recentlyCreated") },
          { value: "number-asc", label: t("requests.sortNumber") },
          { value: "required-asc", label: t("requests.sortNeeded") },
          { value: "priority-desc", label: t("common.priority") },
          { value: "value-desc", label: t("requests.sortValue") },
          { value: "status-asc", label: t("common.status") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<ClipboardList />}
            title={t("requests.noMatch")}
            description={t("common.adjustFilters")}
            action={{ label: t("common.clearFilters"), href: "/procurement/requests" }}
          />
        ) : (
          <EmptyState
            icon={<ClipboardList />}
            title={t("requests.empty")}
            description={
              group
                ? t("requests.emptyGroup")
                : t("requests.emptyCompany")
            }
            action={
              !group && can(context, "procurement.request.create")
                ? { label: t("requests.newRequest"), href: "/procurement/requests/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <RequestTable requests={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
