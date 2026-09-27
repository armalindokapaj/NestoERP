import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ProjectTable } from "@/components/projects/project-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import { parseProjectListQuery } from "@/lib/modules/projects/project.query";
import { PROJECT_SORT_KEYS } from "@/lib/modules/projects/project.schema";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { clearListFilters } from "@/lib/tables/list-url";
import { projectFilterOptions } from "@/lib/modules/projects/project.repository";
import * as projects from "@/lib/modules/projects/project.service";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The archived projects list (PRD #10 §29).
 *
 * All Projects and My Projects used to share this body; E-05A folded them into
 * the Projects page, which discovers live projects only. Archived projects stay
 * here, inside the session's company, until a future filter brings them onto
 * the page (E-05A §10, §55).
 */
export async function ProjectsList({
  context,
  searchParams,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  basePath: string;
}) {
  const query = parseProjectListQuery(searchParams, { archived: true });

  const [result, options] = await Promise.all([
    projects.listProjects(context, query),
    projectFilterOptions(context),
  ]);
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, searchParams, result.pagination.page));

  const hasFilters = Boolean(
    query.search || query.status?.length || query.priority?.length || query.clientId || query.projectManagerMemberId,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: [
        { value: "PENDING", label: "Pending" },
        { value: "ACTIVE", label: "Active" },
        { value: "FINISHED", label: "Finished" },
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

  const buildHref = (page: number) => pageHref(basePath, searchParams, page);
  // Clear filters drops only this list's filter and search keys; the sort and
  // any other route key stay (AUD-08 §3).
  const cleared = clearListFilters(pageHref("", searchParams, 1).slice(1), ["search", "status", "priority", "clientId", "manager"]);
  const clearHref = cleared ? `${basePath}?${cleared}` : basePath;

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
            action={{ label: "Clear filters", href: clearHref }}
          />
        ) : (
          <EmptyState
            icon={<FolderKanban />}
            title="No archived projects."
            description="Projects removed from the Projects page will appear here."
          />
        )
      ) : (
        <>
          <ProjectTable projects={result.data} sort={{ value: query.sort, keys: PROJECT_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
