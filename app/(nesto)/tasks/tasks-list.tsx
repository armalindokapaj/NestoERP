import { redirect } from "next/navigation";
import { SquareCheckBig } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { TaskTable } from "@/components/tasks/task-table";
import { EmptyState } from "@/components/ui/empty-state";
import { WhatIsThis } from "@/components/help/what-is-this";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { clearListFilters } from "@/lib/tables/list-url";
import { parseTaskListQuery, type TaskQueryDefaults } from "@/lib/modules/tasks/task.query";
import { TASK_SORT_KEYS } from "@/lib/modules/tasks/task.schema";
import { getTranslations } from "@/lib/i18n/server";
import { listTasksForWorkspace, taskFilterOptionsForWorkspace } from "@/lib/modules/tasks/task.workspace";

type SearchParams = Record<string, string | string[] | undefined>;

export type TaskListVariant = "mine" | "all" | "overdue" | "completed" | "archived";

const VARIANT_DEFAULTS: Record<TaskListVariant, TaskQueryDefaults> = {
  mine: { mine: true },
  all: {},
  overdue: { due: "overdue", openOnly: true },
  completed: { completedOnly: true, sort: "updated-desc" },
  archived: { archived: true, sort: "updated-desc" },
};

/**
 * The shared list body behind My Tasks, All Tasks, Overdue, Completed and
 * Archived (PRD #11 §26–§30).
 *
 * The five sections differ by their query defaults, not by five
 * implementations — scope, search, filters, sort and pagination are identical.
 */
export async function TasksList({
  context,
  searchParams,
  variant,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  variant: TaskListVariant;
  basePath: string;
}) {
  const query = parseTaskListQuery(searchParams, VARIANT_DEFAULTS[variant]);
  // The Group workspace reads every company the person may open Tasks in; the
  // list is the same, its rows name their company and creation is not offered
  // (Workspace Context §32, §45).
  const group = inGroupWorkspace(context);
  const t = await getTranslations("tasks");

  const [result, options] = await Promise.all([
    listTasksForWorkspace(context, query),
    taskFilterOptionsForWorkspace(context),
  ]);
  // A page past the end (after an archive, a completion or a narrower filter)
  // moves once to the last real page, page 1 when nothing matches (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) {
    redirect(listPageRedirect(basePath, searchParams, result.pagination.page));
  }

  const hasFilters = Boolean(
    query.search ||
      query.status?.length ||
      query.priority?.length ||
      query.projectId ||
      query.assigneeMemberId ||
      (group && query.company) ||
      (query.due && variant !== "overdue") ||
      // A due-date range (a dashboard link sets one) narrows the list just the
      // same: never "No tasks yet" over tasks it hides (AUD-05 §6, UX-11).
      query.dueFrom ||
      query.dueTo,
  );

  const filters: FilterConfig[] = [
    // Group only: a refinement of the list, not the workspace (Workspace Context §86, §87).
    ...(group
      ? [
          {
            param: "company",
            label: t("fields.company"),
            options: options.companies.map((company) => ({ value: company.id, label: company.name })),
          },
        ]
      : []),
    ...(variant === "completed" || variant === "archived"
      ? []
      : [
          {
            param: "status",
            label: t("fields.status"),
            options: (["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as const).map((value) => ({ value, label: t(`status.${value}`) })),
          },
        ]),
    {
      param: "priority",
      label: t("fields.priority"),
      options: (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((value) => ({ value, label: t(`priority.${value}`) })),
    },
    // Project and assignee options come from the scoped task graph, so a
    // dropdown can never name a record the user may not open (PRD #11 §221).
    {
      param: "projectId",
      label: t("fields.project"),
      options: options.projects.map((project) => ({ value: project.id, label: project.name })),
    },
    ...(variant === "mine" || group
      ? []
      : [
          {
            param: "assignee",
            label: t("fields.assignee"),
            options: options.assignees.map((member) => ({
              value: member.id,
              label: member.name,
            })),
          },
        ]),
    ...(variant === "overdue"
      ? []
      : [
          {
            param: "due",
            label: t("fields.due"),
            options: (["overdue", "today", "week", "next7", "none"] as const).map((value) => ({ value, label: t(`list.dueOptions.${value}`) })),
          },
        ]),
  ];

  const buildHref = (page: number) => pageHref(basePath, searchParams, page);
  // Clear filters drops only this list's filter and search keys; the sort and
  // any other route key stay (AUD-08 §3).
  const cleared = clearListFilters(pageHref("", searchParams, 1).slice(1), ["search", "status", "priority", "projectId", "assignee", "due", "dueFrom", "dueTo", "company"]);
  const clearHref = cleared ? `${basePath}?${cleared}` : basePath;

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("list.searchPlaceholder")}
        filters={filters}
        sortOptions={[
          { value: "due-asc", label: t("list.sort.dueAsc") },
          { value: "due-desc", label: t("list.sort.dueDesc") },
          { value: "priority-desc", label: t("list.sort.priorityDesc") },
          { value: "priority-asc", label: t("list.sort.priorityAsc") },
          { value: "updated-desc", label: t("list.sort.updatedDesc") },
          { value: "created-desc", label: t("list.sort.createdDesc") },
          { value: "title-asc", label: t("list.sort.titleAsc") },
          { value: "title-desc", label: t("list.sort.titleDesc") },
        ]}
      />
      {/* What search and filters cover, stated once where people use them (AUD-05 §5, §7, UX-10, UX-15). */}
      <WhatIsThis id="lists.search-filters" title={t("list.helpTitle")}>
        <p>{t("list.helpSearch")}</p>
        <p>{t("list.helpFilters")}</p>
      </WhatIsThis>

      {result.data.length === 0 ? (
        hasFilters ? (
          // A filtered empty list is a different problem from an empty module,
          // and offering "New task" here would be the wrong answer (PRD #11 §155).
          <EmptyState
            icon={<SquareCheckBig />}
            title={t("list.noMatchTitle")}
            description={t("list.noMatchDescription")}
            action={{ label: t("list.clearFilters"), href: clearHref }}
          />
        ) : (
          <EmptyState
            icon={<SquareCheckBig />}
            title={t(`list.emptyTitle.${variant}`)}
            description={group ? t("list.groupEmpty") : t(`list.emptyDescription.${variant}`)}
            action={
              variant !== "archived" && variant !== "completed" && !group && can(context, "task.create")
                ? { label: t("common.newTask"), href: "/tasks/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <TaskTable tasks={result.data} sort={{ value: query.sort, keys: TASK_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
