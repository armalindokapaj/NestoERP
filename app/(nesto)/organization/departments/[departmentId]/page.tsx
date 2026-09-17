import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AppointButton, EndAppointmentButton } from "@/components/organization/department-appointments";
import { DepartmentMemberProjects } from "@/components/organization/department-member-actions";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getDepartmentWorkspace } from "@/lib/modules/organization/department.service";

export const metadata: Metadata = { title: "Department" };

type Props = { params: Promise<{ departmentId: string }> };

/**
 * A department's workspace (E-06 §65-§68): who heads it, each company's branch
 * and manager, and — for its managers and head — the people, the projects each
 * is on, and assigning them to more.
 */
export default async function DepartmentPage({ params }: Props) {
  // Group department ids carry the group's slug and a colon, which arrive encoded.
  const departmentId = decodeURIComponent((await params).departmentId);
  const context = await requireModule("organization");
  if (!can(context, "organization.department.view")) redirect("/access-denied");

  const department = await getDepartmentWorkspace(context, departmentId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Organization", href: "/organization" }, { label: "Departments", href: "/organization/departments" }, { label: department.name }]} />
      <div>
        <h1 className="text-page font-semibold text-fg">{department.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted" data-testid="department-heads">
          <span>Group head:</span>
          {department.heads.length === 0 ? <span>—</span> : null}
          {department.heads.map((head) => (
            <span key={head.assignmentId ?? head.userId} className="inline-flex items-center gap-1.5">
              <span className="text-fg">{head.name}</span>
              {department.appointments.canAppointHead ? <EndAppointmentButton person={head} what={`head of ${department.name}`} /> : null}
            </span>
          ))}
          {department.appointments.canAppointHead ? (
            <AppointButton label="Appoint head" title={`Appoint the head of ${department.name}`} groupDepartmentId={department.id} companyId={null} candidates={department.appointments.headCandidates} />
          ) : null}
        </div>
      </div>

      <section className="nesto-card p-5" aria-labelledby="department-branches">
        <h2 id="department-branches" className="text-card font-semibold text-fg">
          Companies
        </h2>
        {department.branches.length === 0 ? (
          <p className="mt-3 text-table text-fg-muted">No company you can see runs a branch of this department.</p>
        ) : (
          <Table flush className="mt-3" aria-labelledby="department-branches">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Company</TableHeaderCell>
                <TableHeaderCell>Branch</TableHeaderCell>
                <TableHeaderCell>Manager</TableHeaderCell>
                <TableHeaderCell>People</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {department.branches.map((branch) => {
                const appointing = department.appointments.branches.find((row) => row.departmentId === branch.departmentId);
                return (
                <TableRow key={branch.departmentId} data-testid="branch-row">
                  <TableCell className="font-medium">{branch.company.name}</TableCell>
                  <TableCell>{branch.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {branch.managers.length === 0 ? <span>—</span> : null}
                      {branch.managers.map((manager) => (
                        <span key={manager.assignmentId ?? manager.userId} className="inline-flex items-center gap-1.5">
                          {manager.name}
                          {appointing?.canAppointManager ? <EndAppointmentButton person={manager} what={`manager of ${branch.company.name} ${branch.name}`} /> : null}
                        </span>
                      ))}
                      {appointing?.canAppointManager ? (
                        <AppointButton label="Appoint manager" title={`Appoint the manager of ${branch.company.name} ${branch.name}`} groupDepartmentId={department.id} companyId={branch.company.id} candidates={appointing.candidates} />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{branch.memberCount}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {department.members ? (
        <section className="nesto-card p-5" aria-labelledby="department-team">
          <h2 id="department-team" className="text-card font-semibold text-fg">
            Team and projects
          </h2>
          {department.members.length === 0 ? (
            <EmptyState className="mt-3" title="Nobody works here yet" description="People join a branch when their account is created for this department." />
          ) : (
            <Table flush className="mt-3" aria-labelledby="department-team">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Person</TableHeaderCell>
                  <TableHeaderCell>Company</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Projects</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {department.members.map((member) => (
                  <TableRow key={member.memberId} data-testid="department-member">
                    <TableCell className="font-medium">
                      {member.name}
                      {member.isManager ? <span className="ml-2 text-meta text-fg-subtle">Manager</span> : null}
                      {member.jobTitle ? <span className="block text-meta font-normal text-fg-muted">{member.jobTitle}</span> : null}
                    </TableCell>
                    <TableCell>{member.company.name}</TableCell>
                    <TableCell>{member.role}</TableCell>
                    <TableCell>
                      <DepartmentMemberProjects member={member} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      ) : null}
    </div>
  );
}
