import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileQuestion } from "lucide-react";

import { RfqTable } from "@/components/procurement/rfq-table";
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
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";
import { rfqListQuerySchema } from "@/lib/modules/procurement/procurement.schema";
import { RFQ_STATUSES, rfqStatusLabels } from "@/lib/modules/procurement/procurement.status";

export const metadata: Metadata = { title: "Enquiries" };

type SearchParams = Record<string, string | string[] | undefined>;

/** The enquiry register (PRD #19 §252, §253). */
export default async function RfqsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.rfq.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "procurement");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="rfqs"
      actions={
        can(context, "procurement.rfq.create") ? (
          <Button asChild size="sm">
            <Link href="/procurement/rfqs/new">New enquiry</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <RfqList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function RfqList({
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
    .filter((value) => (RFQ_STATUSES as readonly string[]).includes(value));

  const query = rfqListQuerySchema.parse({
    search: read("search"),
    view: read("view") ?? "all",
    status: statuses?.length ? statuses : undefined,
    projectId: read("projectId"),
    sort: read("sort"),
    page: read("page"),
  });

  const [result, options] = await Promise.all([
    rfqs.listRfqs(context, query),
    rfqs.rfqFilterOptions(context),
  ]);

  const hasFilters = Boolean(query.search || query.status?.length || query.projectId);

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: RFQ_STATUSES.map((value) => ({ value, label: rfqStatusLabels[value] })),
    },
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
  ];

  function buildHref(page: number) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") next.set(key, value);
    }
    if (page > 1) next.set("page", String(page));
    const search = next.toString();
    return search ? `/procurement/rfqs?${search}` : "/procurement/rfqs";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search enquiry number or title…"
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently created" },
          { value: "number-asc", label: "Enquiry number" },
          { value: "due-asc", label: "Responses due soonest" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<FileQuestion />}
            title="No enquiries match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/procurement/rfqs" }}
          />
        ) : (
          <EmptyState
            icon={<FileQuestion />}
            title="No enquiries yet."
            description="An enquiry sends the same ask to several suppliers, so their answers can be compared line by line."
            action={
              can(context, "procurement.rfq.create")
                ? { label: "New enquiry", href: "/procurement/rfqs/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <RfqTable rfqs={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
