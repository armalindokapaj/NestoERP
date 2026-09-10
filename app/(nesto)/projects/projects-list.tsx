import { FolderKanban } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ProjectTable } from "@/components/projects/project-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import { parseProjectListQuery } from "@/lib/modules/projects/project.query";
import { projectFilterOptions } from "@/lib/modules/projects/project.repository";
import * as projects from "@/lib/modules/projects/project.service";
import { can } from "@/lib/access/can";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The shared list body behind All Projects, My Projects and Archived
 * (PRD #10 §16, §28, §29).
 *
 * The three sections differ by one query flag, not by three implementations —
 * scope, search, filters and pagination are identical (PRD #10 §99).
 */
export async function ProjectsList({
  context,
  searchParams,
  variant,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  variant: "all" | "mine" | "archived";
  basePath: string;
}) {
  const query = parseProjectListQuery(searchParams, {
    mine: variant === "mine",
    archived: variant === "archived",
  });

  const [result, options] = await Promise.all([
    projects.listProjects(context, query),
    projectFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search || query.status?.length || query.priority?.length || query.clientId || query.projectManagerMemberId,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: [
        { value: "DRAFT", label: "Draft" },
        { value: "ACTIVE", label: "Active" },
        { value: "ON_HOLD", label: "On hold" },
        { value: "COMPLETED", label: "Completed" },
      ],
    },
    {
      param: "priority",
      label: "Priority",
      options: [
        { value: "LOW", label: "Low" },
        { value: "MEDIUM", label: "Medium" },
        { value: "HIGH", label: "High" },
        { value: "CRITICAL", label: "Critical" },
      ],
    },
    // Client and manager options come from the scoped project graph, so a
    // dropdown can never name a record the user may not open (PRD #10 §24).
    {
      param: "clientId",
      label: "Client",
      options: options.clients.map((client) => ({ value: client.id, label: client.name })),
    },
    {
      param: "manager",
      label: "Manager",
      options: options.managers.map((manager) => ({ value: manager.id, label: manager.name })),
    },
  ];

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search projects…"
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently created" },
          { value: "name-asc", label: "Name A–Z" },
          { value: "name-desc", label: "Name Z–A" },
          { value: "start-asc", label: "Start date" },
          { value: "end-asc", label: "End date" },
          { value: "priority-desc", label: "Priority" },
          { value: "status-asc", label: "Status" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          // A filtered empty list is a different problem from an empty module,
          // and offering "New project" here would be the wrong answer
          // (PRD #7 §77).
          <EmptyState
            icon={<FolderKanban />}
            title="No projects match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: basePath }}
          />
        ) : (
          <EmptyState
            icon={<FolderKanban />}
            title={emptyTitle(variant)}
            description={emptyDescription(variant)}
            action={
              variant !== "archived" && can(context, "project.create")
                ? { label: "New project", href: "/projects/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <ProjectTable projects={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}

function emptyTitle(variant: "all" | "mine" | "archived"): string {
  if (variant === "mine") return "No projects assigned to you.";
  if (variant === "archived") return "No archived projects.";
  return "No projects yet.";
}

function emptyDescription(variant: "all" | "mine" | "archived"): string {
  if (variant === "mine") return "Projects you manage or are assigned to will appear here.";
  if (variant === "archived") return "Projects removed from active lists will appear here.";
  return "Projects created by your company will appear here.";
}
