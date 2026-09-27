import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { TaskTable } from "@/components/tasks/task-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { parseTaskListQuery } from "@/lib/modules/tasks/task.query";
import * as tasks from "@/lib/modules/tasks/task.service";

export const metadata: Metadata = { title: "Sales tasks" };

/**
 * Sales follow-up work (PRD #17 §134, §138).
 *
 * The canonical Tasks, filtered to `module = "sales"`. There is no sales task
 * table: the same task appears here, in /tasks and on the record it belongs to,
 * with one id (PRD #17 §333).
 */
export default async function SalesTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  if (!can(context, "sales.task.view") || !can(context, "task.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "sales");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="tasks"
      description="Follow-up work on leads and opportunities. These are ordinary tasks — they appear in Tasks too."
      actions={
        can(context, "task.create") && can(context, "sales.task.create") ? (
          <Button asChild size="sm">
            <Link href="/tasks/new?module=sales">New task</Link>
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <SalesTaskList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function SalesTaskList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // `module` is forced rather than read from the URL: this section is the sales
  // tasks, and a query string must not be able to widen it.
  const query = { ...parseTaskListQuery(searchParams), moduleKey: "sales" };
  const result = await tasks.listTasks(context, query);

  const hasFilters = Boolean(query.search || query.status?.length || query.priority?.length || query.entityId);

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `/sales/tasks?${search}` : "/sales/tasks";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search sales tasks…"
        filters={[
          {
            param: "status",
            label: "Status",
            options: [
              { value: "TODO", label: "To do" },
              { value: "IN_PROGRESS", label: "In progress" },
              { value: "BLOCKED", label: "Blocked" },
              { value: "COMPLETED", label: "Completed" },
            ],
          },
        ]}
        sortOptions={[
          { value: "due-asc", label: "Due soonest" },
          { value: "created-desc", label: "Recently created" },
          { value: "priority-desc", label: "Highest priority" },
        ]}
      />

      {result.data.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={hasFilters ? "No Sales records match these filters." : "No sales tasks yet."}
          description={
            hasFilters
              ? "Adjust or clear the filters to see more."
              : "Follow-up work raised from a lead or an opportunity appears here."
          }
          action={hasFilters ? { label: "Clear filters", href: "/sales/tasks" } : undefined}
        />
      ) : (
        <>
          <TaskTable tasks={result.data} listId="sales.tasks" />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
