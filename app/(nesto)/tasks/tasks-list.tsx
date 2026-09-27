import { redirect } from "next/navigation";
import { SquareCheckBig } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { TaskTable } from "@/components/tasks/task-table";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { clearListFilters } from "@/lib/tables/list-url";
import { parseTaskListQuery, type TaskQueryDefaults } from "@/lib/modules/tasks/task.query";
import { TASK_SORT_KEYS } from "@/lib/modules/tasks/task.schema";
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
      (query.due && variant !== "overdue"),
  );

  const filters: FilterConfig[] = [
    // Group only: a refinement of the list, not the workspace (Workspace Context §86, §87).
    ...(group
      ? [
          {
            param: "company",
            label: "Company",
            options: options.companies.map((company) => ({ value: company.id, label: company.name })),
          },
        ]
      : []),
    ...(variant === "completed" || variant === "archived"
      ? []
      : [
          {
            param: "status",
            label: "Status",
            options: [
              { value: "TODO", label: "To Do" },
              { value: "IN_PROGRESS", label: "In Progress" },
              { value: "BLOCKED", label: "Blocked" },
              { value: "COMPLETED", label: "Completed" },
            ],
          },
        ]),
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
    // Project and assignee options come from the scoped task graph, so a
    // dropdown can never name a record the user may not open (PRD #11 §221).
    {
      param: "projectId",
      label: "Project",
      options: options.projects.map((project) => ({ value: project.id, label: project.name })),
    },
    ...(variant === "mine" || group
      ? []
      : [
          {
            param: "assignee",
            label: "Assignee",
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
            label: "Due",
            options: [
              { value: "overdue", label: "Overdue" },
              { value: "today", label: "Today" },
              { value: "week", label: "This week" },
              { value: "next7", label: "Next 7 days" },
              { value: "none", label: "No due date" },
            ],
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
        searchPlaceholder="Search tasks…"
        filters={filters}
        sortOptions={[
          { value: "due-asc", label: "Due date soonest" },
          { value: "due-desc", label: "Due date latest" },
          { value: "priority-desc", label: "Priority high–low" },
          { value: "priority-asc", label: "Priority low–high" },
          { value: "updated-desc", label: "Recently updated" },
          { value: "created-desc", label: "Recently created" },
          { value: "title-asc", label: "Title A–Z" },
          { value: "title-desc", label: "Title Z–A" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          // A filtered empty list is a different problem from an empty module,
          // and offering "New task" here would be the wrong answer (PRD #11 §155).
          <EmptyState
            icon={<SquareCheckBig />}
            title="No tasks match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: clearHref }}
          />
        ) : (
          <EmptyState
            icon={<SquareCheckBig />}
            title={EMPTY_TITLE[variant]}
            description={group ? "No accessible data for this module." : EMPTY_DESCRIPTION[variant]}
            action={
              variant !== "archived" && variant !== "completed" && !group && can(context, "task.create")
                ? { label: "New task", href: "/tasks/new" }
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

/** Empty-state copy from PRD #11 §152–§154. */
const EMPTY_TITLE: Record<TaskListVariant, string> = {
  mine: "No tasks assigned to you.",
  all: "No tasks yet.",
  overdue: "No overdue tasks.",
  completed: "No completed tasks yet.",
  archived: "No archived tasks.",
};

const EMPTY_DESCRIPTION: Record<TaskListVariant, string> = {
  mine: "Work assigned to you will appear here.",
  all: "Tasks you can see will appear here.",
  overdue: "Everything with a due date is still on time.",
  completed: "Finished work will be listed here.",
  archived: "Tasks removed from active lists will appear here.",
};
