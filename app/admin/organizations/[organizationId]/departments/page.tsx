import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/modules/status-badge";
import {
  ActivateCompaniesButton,
  AddMemberButton,
  AppointButton,
  BranchStatusButton,
  EditDepartmentButton,
  NewDepartmentButton,
  type CandidateOption,
} from "@/components/organization/department-actions";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext, type PlatformContext } from "@/lib/context/platform-context";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { getDepartmentDetail, listDepartmentCandidates, listGroupDepartments } from "@/lib/modules/organization/departments/department.query";
import type { PositionDTO } from "@/lib/modules/organization/departments/department.types";
import { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Departments" };

type Props = { params: Promise<{ organizationId: string }>; searchParams: Promise<{ department?: string }> };

async function options(context: PlatformContext, groupId: string, departmentId: string, position: PositionDTO, company?: string): Promise<CandidateOption[]> {
  const candidates = await listDepartmentCandidates(platformActor(context, groupId), departmentId, { position, company, search: undefined });
  return candidates.filter((candidate) => candidate.eligible && candidate.personId).map((candidate) => ({ personId: candidate.personId!, label: [candidate.name, candidate.jobTitle].filter(Boolean).join(" · ") }));
}

/**
 * Platform Admin → Groups → Group → Departments (E-13 §50, §94, §95): the
 * group's departments, and for one of them its head, the companies it is
 * active in, their managers and first members. The same records and services
 * as the group's own Organization (§51), open while the group is implemented.
 */
export default async function PlatformDepartmentsPage({ params, searchParams }: Props) {
  const { organizationId: groupId } = await params;
  const context = await requirePlatformContext();
  const actor = platformActor(context, groupId);
  const departments = await listGroupDepartments(actor, { status: "ALL" }).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const group = await getGroupImplementation(context, groupId);
  const api = { base: `/api/platform/parent-groups/${groupId}`, platform: true };
  const selectedId = (await searchParams).department ?? departments[0]?.id;
  const selected = selectedId ? await getDepartmentDetail(actor, selectedId).catch(() => null) : null;

  const headOptions = selected?.capabilities.canAssignHead ? await options(context, groupId, selected.id, "GROUP_HEAD") : [];
  const managerOptions = new Map<string, CandidateOption[]>();
  const memberBranches: Array<{ id: string; companyName: string; candidates: CandidateOption[] }> = [];
  if (selected) {
    for (const companyId of selected.capabilities.managerCompanyIds) managerOptions.set(companyId, await options(context, groupId, selected.id, "COMPANY_MANAGER", companyId));
    for (const branchId of selected.capabilities.memberBranchIds) {
      const row = selected.companies.find((candidate) => candidate.branch?.id === branchId)!;
      memberBranches.push({ id: branchId, companyName: row.company.name, candidates: await options(context, groupId, selected.id, "MEMBER", row.company.id) });
    }
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Parent groups", href: "/admin" }, { label: group.group.name, href: `/admin/organizations/${groupId}` }, { label: "Departments" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold text-fg">Departments</h1>
          <p className="mt-1 text-body text-fg-muted">Defined once for {group.group.name}, activated in the companies that run them.</p>
        </div>
        {group.actions.canConfigure ? <NewDepartmentButton api={api} /> : null}
      </div>

      <section className="nesto-card p-5" aria-labelledby="platform-departments">
        <h2 id="platform-departments" className="sr-only">
          The group&apos;s departments
        </h2>
        <Table stack flush aria-labelledby="platform-departments">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Department</TableHeaderCell>
              <TableHeaderCell>Code</TableHeaderCell>
              <TableHeaderCell>Group head</TableHeaderCell>
              <TableHeaderCell>Active companies</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {departments.map((department) => (
              <TableRow key={department.id} data-testid="platform-department" className={cn(department.id === selected?.id && "bg-surface-muted")}>
                <TableCell>
                  <Link href={`?department=${encodeURIComponent(department.id)}`} className="font-medium text-fg hover:text-accent-strong hover:underline" aria-current={department.id === selected?.id ? "true" : undefined}>
                    {department.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-meta">{department.code}</TableCell>
                <TableCell>{department.groupHead?.name ?? <span className="text-fg-subtle">No head</span>}</TableCell>
                <TableCell className="tabular-nums">{department.activeCompanyCount}</TableCell>
                <TableCell>
                  <StatusBadge status={department.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {selected ? (
        <section className="nesto-card space-y-4 p-5" aria-labelledby="selected-department" data-testid="platform-department-setup">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="selected-department" className="text-section font-semibold text-fg">
                {selected.name}
              </h2>
              <Badge tone="neutral">{selected.code}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selected.capabilities.canConfigure ? <EditDepartmentButton api={api} department={selected} /> : null}
              {selected.capabilities.canConfigure && selected.status === "ACTIVE" ? (
                <ActivateCompaniesButton api={api} department={selected} companies={selected.companies.filter((row) => row.branch?.status !== "ACTIVE" && row.company.status === "ACTIVE").map((row) => ({ id: row.company.id, name: row.company.name, reactivates: row.branch !== null }))} />
              ) : null}
              <AddMemberButton api={api} departmentName={selected.name} branches={memberBranches} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-table" data-testid="platform-department-head">
            <span className="text-fg-muted">Group head:</span>
            <span className="text-fg">{selected.groupHead?.name ?? "—"}</span>
            {selected.capabilities.canAssignHead ? <AppointButton api={api} target={{ kind: "head", departmentId: selected.id }} title={`${selected.groupHead ? "Replace" : "Assign"} the head of ${selected.name}`} holder={selected.groupHead?.name ?? null} candidates={headOptions} /> : null}
          </div>
          <Table stack flush aria-label={`${selected.name} by company`}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Company</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Manager</TableHeaderCell>
                <TableHeaderCell>People</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {selected.companies.map((row) => (
                <TableRow key={row.company.id} data-testid="platform-branch">
                  <TableCell className="font-medium">{row.company.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {row.branch ? <StatusBadge status={row.branch.status} /> : <span className="text-meta text-fg-subtle">Not active</span>}
                      {selected.capabilities.canConfigure && selected.status === "ACTIVE" && row.company.status === "ACTIVE" ? <BranchStatusButton api={api} department={selected} company={row.company} status={row.branch?.status ?? null} /> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{row.branch?.manager?.name ?? "—"}</span>
                      {row.branch && selected.capabilities.managerCompanyIds.includes(row.company.id) ? (
                        <AppointButton api={api} target={{ kind: "manager", branchId: row.branch.id }} title={`${row.branch.manager ? "Replace" : "Assign"} the manager of ${selected.name} in ${row.company.name}`} holder={row.branch.manager?.name ?? null} candidates={managerOptions.get(row.company.id) ?? []} />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{row.branch?.memberCount ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!group.actions.canConfigure ? <p className="text-meta text-fg-subtle">The group is live: its Owner and Group IT keep its departments now.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
