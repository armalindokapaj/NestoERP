import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ProjectTable } from "@/components/projects/project-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import { getTranslations } from "@/lib/i18n/server";
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

  const t = await getTranslations("projects");
  const hasFilters = Boolean(
    query.search || query.status?.length || query.priority?.length || query.clientId || query.projectManagerMemberId,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: t("list.status"),
      options: (["PENDING", "ACTIVE", "FINISHED"] as const).map((value) => ({ value, label: t(`status.${value}`) })),
    },
    {
      param: "priority",
      label: t("list.priority"),
      options: (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((value) => ({ value, label: t(`priority.${value}`) })),
    },
    // Client and manager options come from the scoped project graph, so a
    // dropdown can never name a record the user may not open (PRD #10 §24).
    {
      param: "clientId",
      label: t("list.client"),
      options: options.clients.map((client) => ({ value: client.id, label: client.name })),
    },
    {
      param: "manager",
      label: t("list.manager"),
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
        searchPlaceholder={t("list.search")}
        filters={filters}
        sortOptions={[
          { value: "updated-desc", label: t("list.sortUpdated") },
          { value: "created-desc", label: t("list.sortCreated") },
          { value: "name-asc", label: t("list.sortNameAsc") },
          { value: "name-desc", label: t("list.sortNameDesc") },
          { value: "start-asc", label: t("list.sortStart") },
          { value: "end-asc", label: t("list.sortEnd") },
          { value: "priority-desc", label: t("list.priority") },
          { value: "status-asc", label: t("list.status") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          // A filtered empty list is a different problem from an empty module,
          // and offering "New project" here would be the wrong answer
          // (PRD #7 §77).
          <EmptyState
            icon={<FolderKanban />}
            title={t("list.noMatchTitle")}
            description={t("list.noMatchBody")}
            action={{ label: t("list.clearFilters"), href: clearHref }}
          />
        ) : (
          <EmptyState
            icon={<FolderKanban />}
            title={t("list.noArchivedTitle")}
            description={t("list.noArchivedBody")}
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
