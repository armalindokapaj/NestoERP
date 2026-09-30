import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { NewWorkPackageButton } from "@/components/contractors/contractor-dialogs";
import { WorkPackageTable } from "@/components/contractors/contractor-tables";
import { flat, keepPageInRange, orNotFound, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { RecordContextHeader } from "@/components/modules/record-header";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { contractorsOpen } from "@/lib/modules/contractors/contractor.permissions";
import { workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { WORK_PACKAGE_STATUSES, WORK_PACKAGE_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import { DISCIPLINES, DISCIPLINE_LABELS } from "@/lib/modules/engineering/engineering.types";
import * as projects from "@/lib/modules/projects/project.service";
import { listProjectWorkPackagesPage } from "@/lib/modules/work-packages/work-package.service";
import { loadProject, } from "../project-context";

type Params = { params: Promise<{ projectId: string }>; searchParams: SearchParams };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("tabs.workPackages") };
}

/** The project's work packages (PRD #46 §32-§40, §215). */
export default async function ProjectWorkPackagesPage({ params, searchParams }: Params) {
  const [{ projectId }, search] = await Promise.all([params, searchParams]);
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);
  if (!contractorsOpen(context, "work_package.view")) redirect("/access-denied");
  const query = workPackageListSchema.parse(flat(search));
  // Every work package, with a count and pages — before, the tab stopped silently at 500 (AUD-08 §4, DT-05).
  const result = await orNotFound(listProjectWorkPackagesPage(context, project.id, query));
  const base = `/projects/${project.id}/work-packages`;
  keepPageInRange(base, search, query.page, result);
  const archived = project.archivedAt !== null || project.status === "ARCHIVED";

  return (
    <div className="space-y-5">
      <RecordContextHeader title={project.name} subtitle={project.code} status={project.status} actions={!archived && can(context, "work_package.create") ? <NewWorkPackageButton projectId={project.id} /> : null} />
      <ListToolbar
        searchPlaceholder={t("structurePages.workPackageSearch")}
        searchParam="q"
        filters={[
          { param: "status", label: t("structurePages.status"), options: WORK_PACKAGE_STATUSES.map((value) => ({ value, label: WORK_PACKAGE_STATUS_LABELS[value] })) },
          { param: "discipline", label: t("structurePages.discipline"), options: DISCIPLINES.map((value) => ({ value, label: DISCIPLINE_LABELS[value] })) },
        ]}
      />
      {result.items.length === 0 && hasActiveFilters(search, ["q", "status", "discipline"]) ? (
        <NoResultsState noun="work packages" clearHref={base} />
      ) : (
        <WorkPackageTable items={result.items} />
      )}
      <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref(base, search, page)} />
    </div>
  );
}
