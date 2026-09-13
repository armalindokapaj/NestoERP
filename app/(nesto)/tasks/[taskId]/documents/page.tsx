import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { canAccessModule, can } from "@/lib/access/can";
import { loadTask, taskBreadcrumbs } from "../task-context";

type Params = { params: Promise<{ taskId: string }> };

export const metadata: Metadata = { title: "Task documents" };

/**
 * Files attached to a task (PRD #38 §49). The route an upload started from the
 * task returns to, so "Done" lands somewhere real.
 */
export default async function TaskDocumentsPage({ params }: Params) {
  const { taskId } = await params;
  const { context, task } = await loadTask(taskId);
  if (!canAccessModule(context, "documents") || !can(context, "document.view")) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={taskBreadcrumbs(task, "Documents")}
        title={task.title}
        subtitle={task.project ? task.project.name : "Personal task"}
        status={task.status}
        actions={
          <Link href={`/tasks/${task.id}`} className="text-table font-medium text-accent-strong">
            Back to task
          </Link>
        }
      />
      <RecordDocuments
        context={context}
        entityType="task"
        entityId={task.id}
        emptyTitle="No evidence attached."
        emptyDescription="Photographs, drawings and files attached to this task appear here."
      />
    </div>
  );
}
