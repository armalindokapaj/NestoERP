import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import { History } from "lucide-react";

import { can } from "@/lib/access/can";
import * as tasks from "@/lib/modules/tasks/task.service";
import { formatDateTime } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";
import { loadTask, taskBreadcrumbs } from "../task-context";
import { listPageRedirect } from "@/lib/modules/shared/list-query";

type Params = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: t("meta.activity") };
}

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
  const t = await getTranslations("tasks");

  const query = await searchParams;
  const pageValue = Number.parseInt(typeof query.page === "string" ? query.page : "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  const activity = await tasks.listActivity(context, taskId, { page, limit: 25 });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== page) redirect(listPageRedirect(`/tasks/${taskId}/activity`, query, activity.pagination.page));

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={await taskBreadcrumbs(task, t("common.activity"))}
        title={task.title}
        subtitle={task.project ? task.project.name : t("common.personalTask")}
        status={task.status}
      />

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={t("common.noActivity")}
          description={t("detail.activityEmptyDescription")}
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line">
            {activity.data.map((entry) => (
              <li key={entry.id} className="px-5 py-4">
                {/* Messages quote titles and reasons: they wrap, never widen the page (AUD-04 §3, MW-01). */}
                <p className="text-table text-fg [overflow-wrap:anywhere]">
                  {entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : <span className="font-medium">{t("common.someone")}</span>}{" "}
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
