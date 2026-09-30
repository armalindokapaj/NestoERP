import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { ProjectInductions } from "@/components/workforce/project-inductions";
import { SitesManager } from "@/components/workforce/sites-manager";
import { AssignProjectButton, EndMembershipButton } from "@/components/workforce/workforce-actions";
import { CrewTable } from "@/components/workforce/workforce-tables";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { hseEmploymentOptions, inductionsForProject, workersMissingInduction } from "@/lib/modules/hse/hse.workforce";
import { structureCapabilities } from "@/lib/modules/project-structure/structure.permissions";
import { listSites } from "@/lib/modules/project-structure/structure.sites";
import * as projects from "@/lib/modules/projects/project.service";
import { projectWorkforce } from "@/lib/modules/workforce/assignment.service";
import { listCrews } from "@/lib/modules/workforce/crew.service";
import { tradeChoices } from "@/lib/modules/workforce/trade.service";
import { workerChoices } from "@/lib/modules/workforce/workforce.directory";
import { canManageAssignments } from "@/lib/modules/workforce/workforce.permissions";
import { orDash } from "@/lib/utils/format";
import { loadProject, } from "../project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("workforceTab.title") };
}

/**
 * Who works on the project (E-04 §33-§42, §181): its sites, its crews, and the
 * people assigned to it today or due to start — employees with a NESTO account
 * and without. This is where people work, not who may open the project: that
 * is the Team tab (§35).
 */
export default async function ProjectWorkforcePage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);
  if (!actions.canViewWorkforce) redirect("/access-denied");

  const manage = canManageAssignments(context);
  const [sites, crews, assigned, trades, workers] = await Promise.all([
    listSites(context, project.id),
    listCrews(context, { projectId: project.id }),
    projectWorkforce(context, project.id),
    manage ? tradeChoices(context.companyId) : [],
    manage ? workerChoices(context) : [],
  ]);
  const activeSites = sites.filter((site) => site.status === "ACTIVE").map((site) => ({ id: site.id, projectId: project.id, name: site.name }));
  const canManageSites = structureCapabilities(context).canManageStructure;
  // Who has been inducted here, and who works here without it (E-04 §71, §183).
  const showInductions = isModuleEnabled(context, "hse") && canAccessModule(context, "hse") && can(context, "hse.induction.view");
  const canInduct = showInductions && can(context, "hse.induction.record") && project.status !== "ARCHIVED";
  const [inductions, missing, inductees] = showInductions
    ? await Promise.all([inductionsForProject(context, project.id), workersMissingInduction(context, project.id), canInduct ? hseEmploymentOptions(context).then((options) => options.employees) : []])
    : [[], [], []];

  return (
    <div className="space-y-5">
      <RecordContextHeader
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={manage && project.status !== "ARCHIVED" ? <AssignProjectButton projectId={project.id} workers={workers} sites={activeSites} trades={trades} label={t("workforceTab.assignWorker")} variant="primary" /> : null}
      />

      <section className="nesto-card p-0" aria-labelledby="assigned-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="assigned-heading" className="text-card font-semibold text-fg">
            {t("workforceTab.workingHere")}
          </h2>
          <Link href={`/workforce/attendance?projectId=${project.id}`} className="text-table font-medium text-accent-strong hover:underline">
            {t("workforceTab.recordAttendance")}
          </Link>
        </div>
        {assigned.length === 0 ? (
          <p className="px-5 py-6 text-table text-fg-muted">{t("workforceTab.nobody")}</p>
        ) : (
          <Table flush aria-label={t("workforceTab.workingHere")}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("workforceTab.name")}</TableHeaderCell>
                <TableHeaderCell>{t("workforceTab.trade")}</TableHeaderCell>
                <TableHeaderCell>{t("workforceTab.site")}</TableHeaderCell>
                <TableHeaderCell>{t("workforceTab.role")}</TableHeaderCell>
                <TableHeaderCell>{t("workforceTab.from")}</TableHeaderCell>
                {manage ? <TableHeaderCell className="sr-only">{t("workforceTab.actions")}</TableHeaderCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {assigned.map((row) => (
                <TableRow key={row.id} data-testid="project-worker" data-worker-name={row.worker.name}>
                  <TableCell className="font-medium">
                    <PersonLink personId={row.worker.personId} name={row.worker.name} tab="workforce" />
                    {row.isPrimary ? <span className="ml-2 text-meta text-fg-subtle">{t("workforceTab.mainProject")}</span> : null}
                  </TableCell>
                  <TableCell>{orDash(row.tradeName)}</TableCell>
                  <TableCell>{row.site?.name ?? t("workforceTab.wholeProject")}</TableCell>
                  <TableCell>{orDash(row.role)}</TableCell>
                  <TableCell className="tabular-nums">
                    {row.startDate}
                    {row.current ? null : <span className="block text-meta text-fg-subtle">{t("workforceTab.startsThen")}</span>}
                  </TableCell>
                  {manage ? (
                    <TableCell className="text-right">
                      {row.canManage ? <EndMembershipButton employeeId={row.worker.employeeId} membershipId={row.id} what={t("workforceTab.assignmentOf", { name: row.worker.name })} url="project-assignments" /> : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {showInductions ? (
        <ProjectInductions
          projectId={project.id}
          inductions={inductions}
          missing={missing}
          canRecord={canInduct}
          employees={inductees}
          sites={activeSites.map((site) => ({ value: site.id, label: site.name }))}
        />
      ) : null}

      <SitesManager projectId={project.id} sites={sites} canManage={canManageSites && project.status !== "ARCHIVED"} />

      <section className="space-y-2" aria-labelledby="crews-heading">
        <h2 id="crews-heading" className="text-card font-semibold text-fg">
          {t("workforceTab.crews")}
        </h2>
        {crews.length === 0 ? <p className="nesto-card px-5 py-6 text-table text-fg-muted">{t("workforceTab.noCrews")}</p> : <CrewTable crews={crews} />}
      </section>
    </div>
  );
}
