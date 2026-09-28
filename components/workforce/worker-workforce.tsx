import Link from "@/components/navigation/nav-link";

import { StatusBadge } from "@/components/modules/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AssignCrewButton, AssignProjectButton, EndMembershipButton } from "@/components/workforce/workforce-actions";
import { canAccessModule, isModuleEnabled } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { workerHseSummary, type WorkerHseSummary } from "@/lib/modules/hse/hse.workforce";
import { accountStatusLabels, workerCategoryLabels } from "@/lib/modules/hr/hr.status";
import { crewChoices } from "@/lib/modules/workforce/crew.service";
import { tradeChoices } from "@/lib/modules/workforce/trade.service";
import { projectChoices, siteChoices, workforceForPerson } from "@/lib/modules/workforce/workforce.directory";
import type { CrewMembershipDTO, ProjectAssignmentDTO } from "@/lib/modules/workforce/workforce.types";
import { orDash } from "@/lib/utils/format";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";

/**
 * A worker's Workforce tab (E-04 §139, §140; E-09 §7): their trade, their crew
 * and foreman, where they work now and where they did. The same page whether
 * or not they have a NESTO account — the profile is the person's, not a login's.
 */
export async function WorkerWorkforce({ context, personId }: { context: UserContext; personId: string }) {
  const [worker, t, th] = await Promise.all([workforceForPerson(context, personId), getTranslations("workforce"), getTranslations("hr")]);
  if (!worker) return <p className="nesto-card px-5 py-8 text-center text-table text-fg-muted">{t("worker.nothing")}</p>;

  const { canAssignCrew, canAssignProject } = worker.capabilities;
  const projects = canAssignProject ? await projectChoices(context) : [];
  const [crews, sites, trades, safety] = await Promise.all([
    canAssignCrew ? crewChoices(context) : [],
    canAssignProject ? siteChoices(context, projects.map((project) => project.id)) : [],
    canAssignProject ? tradeChoices(context.companyId) : [],
    // A compliance summary only; what happened in an incident stays with it (E-04 §84, §142).
    isModuleEnabled(context, "hse") && canAccessModule(context, "hse") ? workerHseSummary(context, worker.employeeId) : null,
  ]);
  const moveFrom = worker.assignments.filter((row) => row.canManage).map((row) => ({ value: row.id, label: [row.project.name, row.site?.name].filter(Boolean).join(" · ") }));

  return (
    <div className="space-y-5" data-testid="worker-workforce">
      <dl className="nesto-card grid gap-4 p-5 sm:grid-cols-4">
        <Fact label={t("worker.categoryTrade")}>{[worker.workerCategory ? hrLabel(th, "workerCategory", worker.workerCategory, workerCategoryLabels[worker.workerCategory]) : null, worker.trade?.name].filter(Boolean).join(" · ") || "—"}</Fact>
        <Fact label={t("worker.employeeCode")}>{orDash(worker.employeeNumber)}</Fact>
        <Fact label={t("worker.employment")}>
          <StatusBadge status={worker.employmentStatus} />
        </Fact>
        <Fact label={t("worker.account")}>{worker.accountStatus === "HAS_ACCOUNT" ? t("worker.yes") : hrLabel(th, "accountStatus", worker.accountStatus, accountStatusLabels[worker.accountStatus])}</Fact>
      </dl>

      <section className="nesto-card p-0" aria-labelledby="crew-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="crew-heading" className="text-card font-semibold text-fg">
            {t("worker.crew")}
          </h2>
          {canAssignCrew && crews.length ? <AssignCrewButton employeeId={worker.employeeId} crews={crews} name={worker.name} label={worker.crews.length ? t("worker.moveCrew") : t("worker.putInCrew")} /> : null}
        </div>
        {worker.crews.length === 0 ? <p className="px-5 py-5 text-table text-fg-muted">{t("worker.notInCrew")}</p> : <Crews t={t} rows={worker.crews} employeeId={worker.employeeId} name={worker.name} />}
      </section>

      <section className="nesto-card p-0" aria-labelledby="projects-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="projects-heading" className="text-card font-semibold text-fg">
            {t("worker.whereTheyWork")}
          </h2>
          {canAssignProject && projects.length ? <AssignProjectButton employeeId={worker.employeeId} projects={projects} sites={sites} trades={trades} moveFrom={moveFrom} name={worker.name} label={worker.assignments.length ? t("worker.assignOrMove") : t("worker.assignToProject")} /> : null}
        </div>
        {worker.assignments.length === 0 ? <p className="px-5 py-5 text-table text-fg-muted">{t("worker.notAssigned")}</p> : <Assignments t={t} rows={worker.assignments} employeeId={worker.employeeId} name={worker.name} />}
      </section>

      {safety ? <Safety t={t} summary={safety} /> : null}

      {worker.crewHistory.length || worker.assignmentHistory.length ? (
        <section className="nesto-card p-0" aria-labelledby="workforce-history-heading">
          <h2 id="workforce-history-heading" className="border-b border-line px-5 py-3.5 text-card font-semibold text-fg">
            {t("worker.history")}
          </h2>
          {worker.assignmentHistory.length ? <Assignments t={t} rows={worker.assignmentHistory} employeeId={worker.employeeId} name={worker.name} /> : null}
          {worker.crewHistory.length ? <Crews t={t} rows={worker.crewHistory} employeeId={worker.employeeId} name={worker.name} /> : null}
        </section>
      ) : null}
    </div>
  );
}

function Safety({ t, summary }: { t: Translate<"workforce">; summary: WorkerHseSummary }) {
  const valid = summary.inductions.filter((row) => row.valid);
  return (
    <section className="nesto-card p-0" aria-labelledby="worker-safety-heading" data-testid="worker-safety">
      <h2 id="worker-safety-heading" className="border-b border-line px-5 py-3.5 text-card font-semibold text-fg">
        {t("worker.safety")}
      </h2>
      <dl className="grid gap-4 px-5 py-4 sm:grid-cols-4">
        <Fact label={t("worker.validInductions")}>{valid.length ? valid.map((row) => row.project.name).join(", ") : t("worker.none")}</Fact>
        <Fact label={t("worker.toolboxTalks")}>{summary.toolboxTalks}</Fact>
        <Fact label={t("worker.lastPpe")}>{summary.lastPpeCheck ? `${summary.lastPpeCheck.date} · ${summary.lastPpeCheck.result.toLowerCase()}` : t("worker.none")}</Fact>
        <Fact label={t("worker.openPermits")}>{summary.openPermits}</Fact>
      </dl>
      {summary.incidents ? <p className="border-t border-line px-5 py-3 text-meta text-fg-subtle">{t("worker.incidents", { count: summary.incidents })}</p> : null}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-meta text-fg-subtle">{label}</dt>
      <dd className="text-body text-fg">{children}</dd>
    </div>
  );
}

function period(t: Translate<"workforce">, row: { startDate: string; endDate: string | null; current: boolean }): string {
  if (!row.current && row.endDate === null) return t("worker.from", { date: row.startDate });
  return `${row.startDate} – ${row.endDate ?? t("worker.now")}`;
}

function Crews({ t, rows, employeeId, name }: { t: Translate<"workforce">; rows: CrewMembershipDTO[]; employeeId: string; name: string }) {
  return (
    <Table flush aria-label={t("worker.crews")}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>{t("worker.crew")}</TableHeaderCell>
          <TableHeaderCell>{t("worker.role")}</TableHeaderCell>
          <TableHeaderCell>{t("worker.period")}</TableHeaderCell>
          <TableHeaderCell className="sr-only">{t("worker.actions")}</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} data-testid="worker-crew" data-crew-name={row.crew.name}>
            <TableCell className="font-medium">
              <Link className="hover:underline" href={`/workforce/crews/${row.crew.id}`}>
                {row.crew.name}
              </Link>
            </TableCell>
            <TableCell>{orDash(row.role)}</TableCell>
            <TableCell className="tabular-nums">
              {period(t, row)}
              {row.endReason ? <span className="block text-meta text-fg-subtle">{row.endReason}</span> : null}
            </TableCell>
            <TableCell className="text-right">{row.canManage ? <EndMembershipButton employeeId={employeeId} membershipId={row.id} what={t("worker.crewMembership", { name, crew: row.crew.name })} url="crew-assignments" /> : null}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Assignments({ t, rows, employeeId, name }: { t: Translate<"workforce">; rows: ProjectAssignmentDTO[]; employeeId: string; name: string }) {
  return (
    <Table flush aria-label={t("worker.projectAssignments")}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>{t("worker.project")}</TableHeaderCell>
          <TableHeaderCell>{t("worker.site")}</TableHeaderCell>
          <TableHeaderCell>{t("worker.role")}</TableHeaderCell>
          <TableHeaderCell>{t("worker.period")}</TableHeaderCell>
          <TableHeaderCell className="sr-only">{t("worker.actions")}</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} data-testid="worker-assignment" data-project-name={row.project.name}>
            <TableCell className="font-medium">
              {row.project.name}
              {row.isPrimary ? <span className="ml-2 text-meta font-normal text-fg-subtle">{t("worker.main")}</span> : null}
            </TableCell>
            <TableCell>{row.site?.name ?? t("worker.wholeProject")}</TableCell>
            <TableCell>{[row.role, row.trade?.name].filter(Boolean).join(" · ") || "—"}</TableCell>
            <TableCell className="tabular-nums">
              {period(t, row)}
              {row.endReason ? <span className="block text-meta text-fg-subtle">{row.endReason}</span> : null}
            </TableCell>
            <TableCell className="text-right">{row.canManage ? <EndMembershipButton employeeId={employeeId} membershipId={row.id} what={t("worker.assignment", { name, project: row.project.name })} url="project-assignments" /> : null}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
