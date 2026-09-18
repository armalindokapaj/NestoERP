import Link from "next/link";

import { StatusBadge } from "@/components/modules/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AssignCrewButton, AssignProjectButton, EndMembershipButton } from "@/components/workforce/workforce-actions";
import type { UserContext } from "@/lib/context/types";
import { accountStatusLabels, workerCategoryLabels } from "@/lib/modules/hr/hr.status";
import { crewChoices } from "@/lib/modules/workforce/crew.service";
import { tradeChoices } from "@/lib/modules/workforce/trade.service";
import { projectChoices, siteChoices, workforceForPerson } from "@/lib/modules/workforce/workforce.directory";
import type { CrewMembershipDTO, ProjectAssignmentDTO } from "@/lib/modules/workforce/workforce.types";
import { orDash } from "@/lib/utils/format";

/**
 * A worker's Workforce tab (E-04 §139, §140; E-09 §7): their trade, their crew
 * and foreman, where they work now and where they did. The same page whether
 * or not they have a NESTO account — the profile is the person's, not a login's.
 */
export async function WorkerWorkforce({ context, personId }: { context: UserContext; personId: string }) {
  const worker = await workforceForPerson(context, personId);
  if (!worker) return <p className="nesto-card px-5 py-8 text-center text-table text-fg-muted">Nothing to show here.</p>;

  const { canAssignCrew, canAssignProject } = worker.capabilities;
  const projects = canAssignProject ? await projectChoices(context) : [];
  const [crews, sites, trades] = await Promise.all([
    canAssignCrew ? crewChoices(context) : [],
    canAssignProject ? siteChoices(context, projects.map((project) => project.id)) : [],
    canAssignProject ? tradeChoices(context.companyId) : [],
  ]);
  const moveFrom = worker.assignments.filter((row) => row.canManage).map((row) => ({ value: row.id, label: [row.project.name, row.site?.name].filter(Boolean).join(" · ") }));

  return (
    <div className="space-y-5" data-testid="worker-workforce">
      <dl className="nesto-card grid gap-4 p-5 sm:grid-cols-4">
        <Fact label="Category · trade">{[worker.workerCategory ? workerCategoryLabels[worker.workerCategory] : null, worker.trade?.name].filter(Boolean).join(" · ") || "—"}</Fact>
        <Fact label="Employee code">{orDash(worker.employeeNumber)}</Fact>
        <Fact label="Employment">
          <StatusBadge status={worker.employmentStatus} />
        </Fact>
        <Fact label="NESTO account">{worker.accountStatus === "HAS_ACCOUNT" ? "Yes" : accountStatusLabels[worker.accountStatus]}</Fact>
      </dl>

      <section className="nesto-card p-0" aria-labelledby="crew-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="crew-heading" className="text-card font-semibold text-fg">
            Crew
          </h2>
          {canAssignCrew && crews.length ? <AssignCrewButton employeeId={worker.employeeId} crews={crews} name={worker.name} label={worker.crews.length ? "Move to another crew" : "Put in a crew"} /> : null}
        </div>
        {worker.crews.length === 0 ? <p className="px-5 py-5 text-table text-fg-muted">Not in a crew.</p> : <Crews rows={worker.crews} employeeId={worker.employeeId} name={worker.name} />}
      </section>

      <section className="nesto-card p-0" aria-labelledby="projects-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="projects-heading" className="text-card font-semibold text-fg">
            Where they work
          </h2>
          {canAssignProject && projects.length ? <AssignProjectButton employeeId={worker.employeeId} projects={projects} sites={sites} trades={trades} moveFrom={moveFrom} name={worker.name} label={worker.assignments.length ? "Assign or move" : "Assign to project"} /> : null}
        </div>
        {worker.assignments.length === 0 ? <p className="px-5 py-5 text-table text-fg-muted">Not assigned to a project.</p> : <Assignments rows={worker.assignments} employeeId={worker.employeeId} name={worker.name} />}
      </section>

      {worker.crewHistory.length || worker.assignmentHistory.length ? (
        <section className="nesto-card p-0" aria-labelledby="workforce-history-heading">
          <h2 id="workforce-history-heading" className="border-b border-line px-5 py-3.5 text-card font-semibold text-fg">
            History
          </h2>
          {worker.assignmentHistory.length ? <Assignments rows={worker.assignmentHistory} employeeId={worker.employeeId} name={worker.name} /> : null}
          {worker.crewHistory.length ? <Crews rows={worker.crewHistory} employeeId={worker.employeeId} name={worker.name} /> : null}
        </section>
      ) : null}
    </div>
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

function period(row: { startDate: string; endDate: string | null; current: boolean }): string {
  if (!row.current && row.endDate === null) return `From ${row.startDate}`;
  return `${row.startDate} – ${row.endDate ?? "now"}`;
}

function Crews({ rows, employeeId, name }: { rows: CrewMembershipDTO[]; employeeId: string; name: string }) {
  return (
    <Table flush aria-label="Crews">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Crew</TableHeaderCell>
          <TableHeaderCell>Role</TableHeaderCell>
          <TableHeaderCell>Period</TableHeaderCell>
          <TableHeaderCell className="sr-only">Actions</TableHeaderCell>
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
              {period(row)}
              {row.endReason ? <span className="block text-meta text-fg-subtle">{row.endReason}</span> : null}
            </TableCell>
            <TableCell className="text-right">{row.canManage ? <EndMembershipButton employeeId={employeeId} membershipId={row.id} what={`${name}'s membership of ${row.crew.name}`} url="crew-assignments" /> : null}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Assignments({ rows, employeeId, name }: { rows: ProjectAssignmentDTO[]; employeeId: string; name: string }) {
  return (
    <Table flush aria-label="Project assignments">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Project</TableHeaderCell>
          <TableHeaderCell>Site</TableHeaderCell>
          <TableHeaderCell>Role</TableHeaderCell>
          <TableHeaderCell>Period</TableHeaderCell>
          <TableHeaderCell className="sr-only">Actions</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} data-testid="worker-assignment" data-project-name={row.project.name}>
            <TableCell className="font-medium">
              {row.project.name}
              {row.isPrimary ? <span className="ml-2 text-meta font-normal text-fg-subtle">main</span> : null}
            </TableCell>
            <TableCell>{row.site?.name ?? "Whole project"}</TableCell>
            <TableCell>{[row.role, row.trade?.name].filter(Boolean).join(" · ") || "—"}</TableCell>
            <TableCell className="tabular-nums">
              {period(row)}
              {row.endReason ? <span className="block text-meta text-fg-subtle">{row.endReason}</span> : null}
            </TableCell>
            <TableCell className="text-right">{row.canManage ? <EndMembershipButton employeeId={employeeId} membershipId={row.id} what={`${name}'s assignment to ${row.project.name}`} url="project-assignments" /> : null}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
