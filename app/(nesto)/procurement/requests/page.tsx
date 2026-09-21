import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
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

export const metadata: Metadata = { title: "Purchase requests" };

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
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="requests"
      actions={
        !inGroupWorkspace(context) && can(context, "procurement.request.create") ? (
          <Button asChild size="sm">
            <Link href="/procurement/requests/new">New request</Link>
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
      ? [{ param: "company", label: "Company", options: options.companies }]
      : []),
    {
      param: "status",
      label: "Status",
      options: REQUEST_STATUSES.filter((status) => status !== "ARCHIVED").map((value) => ({
        value,
        label: requestStatusLabels[value],
      })),
    },
    {
      param: "priority",
      label: "Priority",
      options: PRIORITIES.map((value) => ({ value, label: priorityLabels[value] })),
    },
    {
      param: "category",
      label: "Category",
      options: CATEGORIES.map((value) => ({ value, label: categoryLabels[value] })),
    },
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
    ...(options.requesters.length > 1
      ? [
          {
            param: "requestedBy",
            label: "Raised by",
            options: options.requesters.map((member) => ({
              value: member.id,
              label: `${member.user.firstName} ${member.user.lastName}${member.company ? ` · ${member.company.name}` : ""}`,
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
    return search ? `/procurement/requests?${search}` : "/procurement/requests";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search number, title or line…"
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently created" },
          { value: "number-asc", label: "Request number" },
          { value: "required-asc", label: "Needed soonest" },
          { value: "priority-desc", label: "Priority" },
          { value: "value-desc", label: "Estimated value" },
          { value: "status-asc", label: "Status" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<ClipboardList />}
            title="No requests match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/procurement/requests" }}
          />
        ) : (
          <EmptyState
            icon={<ClipboardList />}
            title="No purchase requests yet."
            description={
              group
                ? "No company you can read has a purchase request yet. Raising one is done inside a company."
                : "A request is somebody asking to buy something. Nothing is committed until an order is issued."
            }
            action={
              !group && can(context, "procurement.request.create")
                ? { label: "New request", href: "/procurement/requests/new" }
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
