import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
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
import {
  INSPECTION_TYPES,
  TEMPLATE_STATUSES,
  inspectionTypeLabels,
  templateStatusLabels,
} from "@/lib/modules/qaqc/qaqc.status";

export const metadata: Metadata = { title: "Inspection templates" };

type SearchParams = Record<string, string | string[] | undefined>;

/** The checklists a company inspects against (PRD #21 §49–§53). */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.template.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "qaqc");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="templates"
      description="The checklists inspections are carried out against. Editing one that has been used writes a new version and leaves the old one alone."
      actions={
        can(context, "qaqc.template.create") ? (
          <Button asChild size="sm">
            <Link href="/qaqc/templates/new">New template</Link>
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
  });

  const result = await templates.listTemplates(context, query);
  const hasFilters = Boolean(query.search || query.status?.length || query.inspectionType?.length);

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: TEMPLATE_STATUSES.map((value) => ({ value, label: templateStatusLabels[value] })),
    },
    {
      param: "type",
      label: "Type",
      options: INSPECTION_TYPES.map((value) => ({ value, label: inspectionTypeLabels[value] })),
    },
  ];

  function buildHref(page: number) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") next.set(key, value);
    }
    if (page > 1) next.set("page", String(page));
    const search = next.toString();
    return search ? `/qaqc/templates?${search}` : "/qaqc/templates";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search code or name…"
        filters={filters}
        sortOptions={[
          { value: "code-asc", label: "By code" },
          { value: "name-asc", label: "Name A–Z" },
          { value: "updated-desc", label: "Recently updated" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<ClipboardList />}
            title="No templates match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/qaqc/templates" }}
          />
        ) : (
          <EmptyState
            icon={<ClipboardList />}
            title="No templates yet."
            description="A template is the checklist an inspection is carried out against. Keeping one list means two sites cannot quietly hold the same work to different standards."
            action={
              can(context, "qaqc.template.create")
                ? { label: "New template", href: "/qaqc/templates/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <TemplateTable templates={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
