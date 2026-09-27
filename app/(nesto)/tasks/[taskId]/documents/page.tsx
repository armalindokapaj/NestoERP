import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { canAccessModule, can } from "@/lib/access/can";
import { getTranslations } from "@/lib/i18n/server";
import { loadTask, taskBreadcrumbs } from "../task-context";

type Params = { params: Promise<{ taskId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: t("meta.documents") };
}

/**
 * Files attached to a task (PRD #38 §49). The route an upload started from the
 * task returns to, so "Done" lands somewhere real.
 */
export default async function TaskDocumentsPage({ params }: Params) {
  const { taskId } = await params;
  const { context, task } = await loadTask(taskId);
  if (!canAccessModule(context, "documents") || !can(context, "document.view")) notFound();
  const t = await getTranslations("tasks");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={await taskBreadcrumbs(task, t("common.documents"))}
        title={task.title}
        subtitle={task.project ? task.project.name : t("common.personalTask")}
        status={task.status}
        actions={
          <Link href={`/tasks/${task.id}`} className="text-table font-medium text-accent-strong">
            {t("detail.backToTask")}
          </Link>
        }
      />
      <RecordDocuments
        context={context}
        entityType="task"
        entityId={task.id}
        emptyTitle={t("common.noEvidence")}
        emptyDescription={t("common.evidenceDescription")}
      />
    </div>
  );
}
