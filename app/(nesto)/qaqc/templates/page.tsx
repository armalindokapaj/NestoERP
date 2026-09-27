import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";

import { TemplateTable } from "@/components/qaqc/qaqc-tables";
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
import * as templates from "@/lib/modules/qaqc/templates/template.service";
import { templateListQuerySchema } from "@/lib/modules/qaqc/qaqc.schema";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { clearListFilters } from "@/lib/tables/list-url";
import {
  INSPECTION_TYPES,
  TEMPLATE_STATUSES,
} from "@/lib/modules/qaqc/qaqc.status";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.templates") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The checklists a company inspects against (PRD #21 §49–§53).
 *
 * AUD-08 (§3–§5): one parsed query (search, status, type, sort, page, page
 * size); a page past the end moves once to the last real page; header sorts
 * only for the allowlisted orders; the table is `qaqc.templates`.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  if (!can(context, "qaqc.template.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="templates"
      description={t("descriptions.templates")}
      actions={
        can(context, "qaqc.template.create") ? (
          <Button asChild size="sm">
            <Link href="/qaqc/templates/new">{t("common.newTemplate")}</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={6} />}>
        <TemplateList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function TemplateList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const t = await getTranslations("qaqc");
  const read = (key: string) =>
    typeof searchParams[key] === "string" ? (searchParams[key] as string) : undefined;

  const statuses = read("status")
    ?.split(",")
    .filter((value) => (TEMPLATE_STATUSES as readonly string[]).includes(value));
  const types = read("type")
    ?.split(",")
    .filter((value) => (INSPECTION_TYPES as readonly string[]).includes(value));

  const query = templateListQuerySchema.parse({
    search: read("search"),
    status: statuses?.length ? statuses : undefined,
    inspectionType: types?.length ? types : undefined,
    sort: read("sort"),
    page: read("page"),
    limit: read("limit"),
  });

  const result = await templates.listTemplates(context, query);
  if (result.pagination.page !== query.page) {
    redirect(listPageRedirect("/qaqc/templates", searchParams, result.pagination.page));
  }
  const hasFilters = Boolean(query.search || query.status?.length || query.inspectionType?.length);

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: t("list.filter.status"),
      options: TEMPLATE_STATUSES.map((value) => ({ value, label: qaqcLabel(t, "templateStatus", value) })),
    },
    {
      param: "type",
      label: t("list.filter.type"),
      options: INSPECTION_TYPES.map((value) => ({ value, label: qaqcLabel(t, "inspectionType", value) })),
    },
  ];

  const buildHref = (page: number) => pageHref("/qaqc/templates", searchParams, page);
  // Clear drops search and filters, keeps sort and page size (AUD-08 §3).
  const cleared = clearListFilters(pageHref("", searchParams, 1).replace(/^\?/, ""), ["search", "status", "type"]);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("list.search.templates")}
        filters={filters}
        sortOptions={[
          { value: "code-asc", label: t("list.sort.byCode") },
          { value: "name-asc", label: t("list.sort.nameAz") },
          { value: "updated-desc", label: t("list.sort.recentlyUpdated") },
        ]}
        applied={{ sort: query.sort }}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<ClipboardList />}
            title={t("list.noTemplatesMatch")}
            description={t("common.adjustFilters")}
            action={{ label: t("common.clearFilters"), href: cleared ? `/qaqc/templates?${cleared}` : "/qaqc/templates" }}
          />
        ) : (
          <EmptyState
            icon={<ClipboardList />}
            title={t("list.noTemplates")}
            description={t("list.noTemplatesBody")}
            action={
              can(context, "qaqc.template.create")
                ? { label: t("common.newTemplate"), href: "/qaqc/templates/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <TemplateTable
            templates={result.data}
            listId="qaqc.templates"
            sort={{ value: query.sort, keys: ["code-asc", "name-asc", "updated-desc"] }}
          />
          <Pagination
            meta={result.pagination}
            buildHref={buildHref}
            pageSizes={[25, 50, 100]}
            listId="qaqc.templates"
          />
        </>
      )}
    </div>
  );
}
