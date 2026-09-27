import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.salesTasks") };
}

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
  const t = await getTranslations("sales");
  if (!can(context, "sales.task.view") || !can(context, "task.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "sales");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="tasks"
      description={t("tasks.description")}
      actions={
        can(context, "task.create") && can(context, "sales.task.create") ? (
          <Button asChild size="sm">
            <Link href="/tasks/new?module=sales">{t("tasks.newTask")}</Link>
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
  const t = await getTranslations("sales");
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
        searchPlaceholder={t("tasks.search")}
        filters={[
          {
            param: "status",
            label: t("lists.status"),
            options: [
              { value: "TODO", label: t("tasks.todo") },
              { value: "IN_PROGRESS", label: t("tasks.inProgress") },
              { value: "BLOCKED", label: t("tasks.blocked") },
              { value: "COMPLETED", label: t("tasks.completed") },
            ],
          },
        ]}
        sortOptions={[
          { value: "due-asc", label: t("tasks.dueSoonest") },
          { value: "created-desc", label: t("lists.recentlyCreated") },
          { value: "priority-desc", label: t("tasks.highestPriority") },
        ]}
      />

      {result.data.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={hasFilters ? t("lists.noMatchTitle") : t("tasks.none")}
          description={
            hasFilters
              ? t("lists.noMatchDescription")
              : t("tasks.noneDescription")
          }
          action={hasFilters ? { label: t("lists.clearFilters"), href: "/sales/tasks" } : undefined}
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
