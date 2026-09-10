import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { History } from "lucide-react";

import { can } from "@/lib/access/can";
import * as tasks from "@/lib/modules/tasks/task.service";
import { formatDateTime } from "@/lib/utils/format";
import { loadTask, taskBreadcrumbs } from "../task-context";

type Params = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Task Activity" };

/**
 * Full task history (PRD #11 §75, §166, §168).
 *
 * Requires `task.activity.view` on top of task access, so history is not a way
 * around the permission that governs the record itself (PRD #11 §78).
 */
export default async function TaskActivityPage({ params, searchParams }: Params) {
  const { taskId } = await params;
  const { context, task } = await loadTask(taskId);

  if (!can(context, "task.activity.view")) notFound();

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await tasks.listActivity(context, taskId, { page, limit: 25 });

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={taskBreadcrumbs(task, "Activity")}
        title={task.title}
        subtitle={task.project ? task.project.name : "Personal task"}
        status={task.status}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No activity recorded yet."
          description="Changes to this task will be listed here."
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                <p className="text-table text-fg">
                  <span className="font-medium">{entry.actor ?? "Someone"}</span>{" "}
                  {entry.message ?? entry.action}
                </p>
                <p className="mt-0.5 text-meta text-fg-subtle">
                  {formatDateTime(entry.createdAt)}
                </p>
              </li>
            ))}
          </ol>
          <Pagination
            meta={activity.pagination}
            buildHref={(next) =>
              next > 1 ? `/tasks/${task.id}/activity?page=${next}` : `/tasks/${task.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
