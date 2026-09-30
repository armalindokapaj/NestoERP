import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { EmptyState } from "@/components/ui/empty-state";
import * as projects from "@/lib/modules/projects/project.service";
import { formatDateTime } from "@/lib/utils/format";
import { loadProject, } from "../project-context";
import { listPageRedirect } from "@/lib/modules/shared/list-query";

type Params = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("tabs.activity") };
}

/**
 * Project activity (PRD #10 §87, §90).
 *
 * Filtered to the modules this person may see: Finance activity on a shared
 * project does not reach an Architect just because they can open the project.
 */
export default async function ProjectActivityPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const { page } = await searchParams;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);

  if (!actions.canViewActivity) redirect("/access-denied");

  const currentPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const activity = await projects.listActivity(context, projectId, {
    page: currentPage,
    limit: 25,
  });
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (activity.pagination.page !== currentPage) redirect(listPageRedirect(`/projects/${projectId}/activity`, {}, activity.pagination.page));

  return (
    <div className="space-y-5">
      <RecordContextHeader
        title={project.name}
        subtitle={project.code}
        status={project.status}
      />


      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={t("tabPages.noActivityTitle")}
          description={t("tabPages.noActivityBody")}
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line p-5">
            {activity.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 py-3 first:pt-0 last:pb-0">
                <span className="text-table font-medium text-fg">{entry.actor ? <PersonLink memberId={entry.actorMemberId} name={entry.actor} /> : "NESTO"}</span>
                <span className="text-table text-fg-muted">{entry.message ?? entry.action}</span>
                <span className="ml-auto text-meta tabular-nums text-fg-subtle">
                  {formatDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ol>

          <Pagination
            meta={activity.pagination}
            buildHref={(next) =>
              next > 1
                ? `/projects/${project.id}/activity?page=${next}`
                : `/projects/${project.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
