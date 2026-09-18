import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import {
  ActivateCompaniesButton,
  AddMemberButton,
  AppointButton,
  BranchStatusButton,
  DepartmentStatusButton,
  EditDepartmentButton,
  EndAssignmentButton,
  MovePlaceButton,
  type CandidateOption,
} from "@/components/organization/department-actions";
import { POSITION_LABEL } from "@/components/organization/department-labels";
import { DepartmentMemberProjects } from "@/components/organization/department-member-actions";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { modulesOfFunction } from "@/config/group-departments";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { listAccessGrants } from "@/lib/modules/organization/access-grant.service";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { getDepartmentActivity, getDepartmentDetail, getDepartmentTeam, listDepartmentCandidates } from "@/lib/modules/organization/departments/department.query";
import { teamQuerySchema } from "@/lib/modules/organization/departments/department.schema";
import type { DepartmentCompanyRowDTO, DepartmentDetailDTO, PositionDTO, TeamMemberDTO } from "@/lib/modules/organization/departments/department.types";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Department" };

type Props = { params: Promise<{ departmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const API = { base: "/api/organization", platform: false };
const TABS = ["overview", "companies", "team", "access", "activity"] as const;
type Tab = (typeof TABS)[number];

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

function PersonName({ person }: { person: { personId: string | null; name: string } }) {
  return person.personId ? (
    <Link href={`/people/${person.personId}`} className="font-medium text-fg hover:text-accent-strong hover:underline">
      {person.name}
    </Link>
  ) : (
    <span className="font-medium text-fg">{person.name}</span>
  );
}

async function options(context: UserContext, departmentId: string, position: PositionDTO, company?: string): Promise<CandidateOption[]> {
  const candidates = await listDepartmentCandidates(memberActor(context), departmentId, { position, company, search: undefined });
  return candidates.filter((candidate) => candidate.eligible && candidate.personId).map((candidate) => ({ personId: candidate.personId!, label: [candidate.name, candidate.jobTitle].filter(Boolean).join(" · ") }));
}

/**
 * A department's page (E-13 §33-§38): its overview and head, the companies it
 * is active in with their managers, its team across those companies, the
 * access that belongs to it, and what happened to it. Every company the reader
 * may see shows without switching company (§86).
 */
export default async function DepartmentPage({ params, searchParams }: Props) {
  // Group department ids carry the group's id and a colon, which arrive encoded.
  const departmentId = decodeURIComponent((await params).departmentId);
  const context = await requireModule("organization");
  if (!can(context, "organization.department.view")) redirect("/access-denied");
  const query = await searchParams;

  const department = await getDepartmentDetail(memberActor(context), departmentId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const visible = TABS.filter((tab) => (tab === "team" || tab === "activity" ? department.capabilities.canViewTeam : tab === "access" ? department.capabilities.canViewAccess : true));
  const requested = one(query.tab) as Tab | undefined;
  const tab: Tab = requested && visible.includes(requested) ? requested : "overview";
  const href = (key: Tab) => `/organization/departments/${encodeURIComponent(department.id)}${key === "overview" ? "" : `?tab=${key}`}`;

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Organization", href: "/organization" }, { label: "Departments", href: "/organization/departments" }, { label: department.name }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-page font-semibold text-fg">{department.name}</h1>
            <Badge tone="neutral">{department.code}</Badge>
            <StatusBadge status={department.status} />
          </div>
          {department.description ? <p className="mt-1 max-w-3xl text-body text-fg-muted">{department.description}</p> : null}
        </div>
        {department.capabilities.canConfigure ? (
          <div className="flex flex-wrap items-center gap-2">
            <EditDepartmentButton api={API} department={department} />
            <DepartmentStatusButton department={department} />
          </div>
        ) : null}
      </header>

      <nav aria-label="Department sections" className="border-b border-line">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {visible.map((key) => (
            <li key={key}>
              <Link
                href={href(key)}
                aria-current={key === tab ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors",
                  key === tab ? "border-accent text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" ? <Overview context={context} department={department} /> : null}
      {tab === "companies" ? <Companies context={context} department={department} /> : null}
      {tab === "team" ? <Team context={context} department={department} query={query} /> : null}
      {tab === "access" ? <Access context={context} department={department} /> : null}
      {tab === "activity" ? <Activity context={context} department={department} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

async function Overview({ context, department }: { context: UserContext; department: DepartmentDetailDTO }) {
  const head = department.groupHead;
  const headCandidates = department.capabilities.canAssignHead ? await options(context, department.id, "GROUP_HEAD") : [];
  const activatable = department.capabilities.canConfigure && department.status === "ACTIVE"
    ? department.companies.filter((row) => row.branch?.status !== "ACTIVE" && row.company.status === "ACTIVE").map((row) => ({ id: row.company.id, name: row.company.name, reactivates: row.branch !== null }))
    : [];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="nesto-card space-y-3 p-5 lg:col-span-2" aria-labelledby="department-head">
        <h2 id="department-head" className="text-card font-semibold text-fg">
          Group head
        </h2>
        <div className="flex flex-wrap items-center gap-3" data-testid="department-head">
          {head ? (
            <>
              <PersonName person={head} />
              {head.jobTitle ? <span className="text-meta text-fg-muted">{head.jobTitle}</span> : null}
              {head.since ? <span className="text-meta text-fg-subtle">since {dateOf(head.since)}</span> : null}
              {department.capabilities.canAssignHead ? <EndAssignmentButton assignmentId={head.assignmentId} personName={head.name} what={`head of ${department.name}`} /> : null}
            </>
          ) : (
            <span className="text-table text-fg-muted">No group head assigned.</span>
          )}
          {department.capabilities.canAssignHead ? (
            <AppointButton api={API} target={{ kind: "head", departmentId: department.id }} title={head ? `Replace the head of ${department.name}` : `Assign the head of ${department.name}`} holder={head?.name ?? null} candidates={headCandidates} />
          ) : null}
        </div>
        <p className="text-meta text-fg-subtle">
          {department.bindsRoles
            ? "The head oversees the function across the group's companies. The position widens what they already work as, and nothing else."
            : "A department the group added: its head and managers are recorded and notified, and their positions widen no access."}
        </p>
      </section>
      <section className="nesto-card space-y-3 p-5" aria-label="Summary">
        <dl className="grid grid-cols-2 gap-3 text-table">
          <div>
            <dt className="text-meta text-fg-subtle">Active companies</dt>
            <dd className="text-section font-semibold tabular-nums text-fg">{department.activeCompanyCount}</dd>
          </div>
          <div>
            <dt className="text-meta text-fg-subtle">People</dt>
            <dd className="text-section font-semibold tabular-nums text-fg">{department.memberCount}</dd>
          </div>
        </dl>
        <ActivateCompaniesButton api={API} department={department} companies={activatable} />
      </section>
    </div>
  );
}

async function Companies({ context, department }: { context: UserContext; department: DepartmentDetailDTO }) {
  const managerOptions = new Map<string, CandidateOption[]>();
  for (const companyId of department.capabilities.managerCompanyIds) managerOptions.set(companyId, await options(context, department.id, "COMPANY_MANAGER", companyId));

  const columns: TableColumn<DepartmentCompanyRowDTO>[] = [
    { key: "company", label: "Company", primary: true, render: (row) => <span className="font-medium text-fg">{row.company.name}</span> },
    {
      key: "manager",
      label: "Manager",
      render: (row) => {
        if (!row.branch) return <span className="text-fg-subtle">—</span>;
        const manager = row.branch.manager;
        const may = department.capabilities.managerCompanyIds.includes(row.company.id);
        return (
          <div className="flex flex-wrap items-center gap-2">
            {manager ? <PersonName person={manager} /> : <span className="text-fg-subtle">No manager assigned.</span>}
            {manager && may ? <EndAssignmentButton assignmentId={manager.assignmentId} personName={manager.name} what={`manager of ${department.name} in ${row.company.name}`} /> : null}
            {may ? (
              <AppointButton api={API} target={{ kind: "manager", branchId: row.branch.id }} title={`${manager ? "Replace" : "Assign"} the manager of ${department.name} in ${row.company.name}`} holder={manager?.name ?? null} candidates={managerOptions.get(row.company.id) ?? []} />
            ) : null}
          </div>
        );
      },
    },
    { key: "members", label: "People", align: "right", render: (row) => <span className="tabular-nums">{row.branch?.memberCount ?? 0}</span> },
    {
      key: "status",
      label: "Status",
      render: (row) => (row.branch ? <StatusBadge status={row.branch.status} /> : <span className="text-meta text-fg-subtle">Not active here</span>),
    },
  ];

  const configures = department.capabilities.canConfigure && department.status === "ACTIVE";
  return (
    <section aria-label="Companies">
      {department.companies.length === 0 ? (
        <EmptyState title="No company to show" description="No company you can see runs this department." />
      ) : (
        <DataTable
          caption={`${department.name} by company`}
          columns={columns}
          records={department.companies}
          rowKey={(row) => row.company.id}
          actions={(row) => (
            <div className="flex flex-wrap items-center justify-end gap-1" data-testid="branch-actions">
              {configures && row.company.status === "ACTIVE" ? <BranchStatusButton api={API} department={department} company={row.company} status={row.branch?.status ?? null} /> : null}
              {row.branch && department.capabilities.canViewTeam ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/organization/departments/${encodeURIComponent(department.id)}?tab=team&company=${row.company.id}`}>View team</Link>
                </Button>
              ) : null}
            </div>
          )}
        />
      )}
    </section>
  );
}

async function Team({ context, department, query }: { context: UserContext; department: DepartmentDetailDTO; query: Record<string, string | string[] | undefined> }) {
  const filters = teamQuerySchema.parse({ company: one(query.company), position: one(query.position), status: one(query.status), search: one(query.search) });
  const team = await getDepartmentTeam(memberActor(context), department.id, filters);
  const branches: Array<{ id: string; companyName: string; candidates: CandidateOption[] }> = [];
  for (const branchId of department.capabilities.memberBranchIds) {
    const row = department.companies.find((candidate) => candidate.branch?.id === branchId)!;
    branches.push({ id: branchId, companyName: row.company.name, candidates: await options(context, department.id, "MEMBER", row.company.id) });
  }
  const filtered = Boolean(filters.company || filters.position || filters.search || filters.status !== "ACTIVE");

  const columns: TableColumn<TeamMemberDTO>[] = [
    {
      key: "person",
      label: "Person",
      primary: true,
      render: (member) => (
        <span className="min-w-0">
          <PersonName person={member.person} />
          {member.person.jobTitle ? <span className="block text-meta font-normal text-fg-muted">{member.person.jobTitle}</span> : null}
        </span>
      ),
    },
    { key: "primary", label: "Primary company", hideBelow: "lg", render: (member) => member.primaryCompany?.name ?? "—" },
    { key: "position", label: "Position", render: (member) => <Badge tone={member.position === "MEMBER" ? "neutral" : "info"}>{POSITION_LABEL[member.position]}</Badge> },
    {
      key: "coverage",
      label: "Companies",
      render: (member) =>
        member.coverage.length === 0 ? (
          <span className="text-meta text-fg-subtle">The whole group</span>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Companies ${member.person.name} works in for ${department.name}`}>
            {member.coverage.map((place) => (
              <li key={place.assignmentId} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-meta" data-testid="coverage">
                {place.company.name}
                {place.position === "COMPANY_MANAGER" ? <span className="text-fg-subtle">· Manager</span> : null}
                {!place.hasAccess ? <span className="text-warning-strong">· no access</span> : null}
                {place.status === "INACTIVE" ? <span className="text-fg-subtle">· ended</span> : null}
                {place.removableAssignmentId ? (
                  <>
                    <MovePlaceButton
                      assignmentId={place.removableAssignmentId}
                      personName={member.person.name}
                      from={place.company.name}
                      branches={branches.filter((branch) => !member.coverage.some((other) => other.branchId === branch.id && other.status === "ACTIVE")).map((branch) => ({ id: branch.id, companyName: branch.companyName }))}
                    />
                    <EndAssignmentButton assignmentId={place.removableAssignmentId} personName={member.person.name} what={`${department.name} in ${place.company.name}`} label="Remove" />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ),
    },
    { key: "projects", label: "Projects", hideBelow: "lg", render: (member) => <DepartmentMemberProjects member={member} /> },
    { key: "status", label: "Status", hideBelow: "xl", render: (member) => (member.status === "NO_ACCESS" ? <Badge tone="warning">No access in a company</Badge> : <StatusBadge status={member.status} />) },
  ];

  return (
    <section className="space-y-4" aria-label="Team">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter the team">
          <input type="hidden" name="tab" value="team" />
          <label className="flex flex-col gap-1 text-meta font-medium text-fg-muted">
            Company
            <select name="company" defaultValue={filters.company ?? ""} className={selectClass}>
              <option value="">Every company</option>
              {team.filters.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-meta font-medium text-fg-muted">
            Position
            <select name="position" defaultValue={filters.position ?? ""} className={selectClass}>
              <option value="">Any</option>
              {(Object.keys(POSITION_LABEL) as PositionDTO[]).map((position) => (
                <option key={position} value={position}>
                  {POSITION_LABEL[position]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-meta font-medium text-fg-muted">
            Status
            <select name="status" defaultValue={filters.status} className={selectClass}>
              <option value="ACTIVE">Current</option>
              <option value="INACTIVE">Ended</option>
              <option value="ALL">All</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-meta font-medium text-fg-muted">
            Search
            <Input name="search" type="search" defaultValue={filters.search ?? ""} placeholder="Name" />
          </label>
          <Button type="submit" variant="secondary" size="sm">
            Filter
          </Button>
          {filtered ? (
            <Link href={`/organization/departments/${encodeURIComponent(department.id)}?tab=team`} className="pb-2 text-meta text-accent-strong hover:underline">
              Clear
            </Link>
          ) : null}
        </form>
        {department.status === "ACTIVE" ? <AddMemberButton api={API} departmentName={department.name} branches={branches} /> : null}
      </div>
      {team.data.length === 0 ? (
        <EmptyState title={filtered ? "Nobody matches" : "Nobody works here yet"} description={filtered ? "Try fewer filters." : "Add somebody who already works in one of its companies."} />
      ) : (
        <DataTable caption={`${department.name} team`} columns={columns} records={team.data} rowKey={(member) => member.person.userId} />
      )}
    </section>
  );
}

async function Access({ context, department }: { context: UserContext; department: DepartmentDetailDTO }) {
  const modules = modulesOfFunction(department.key) as readonly string[];
  const grants = modules.length > 0 ? (await listAccessGrants(context, { status: "live" })).filter((grant) => modules.includes(grant.module.key)) : [];
  return (
    <section className="space-y-4" aria-label="Access">
      <p className="max-w-3xl text-table text-fg-muted">
        Being in {department.name} grants no access by itself. Access comes from each person&apos;s role, the position they hold, and what was delegated to them.
        {modules.length > 0 ? ` These are the delegations in the modules ${department.name} owns.` : ` ${department.name} owns no module, so nothing is delegated through it.`}
      </p>
      {modules.length > 0 ? (
        grants.length === 0 ? (
          <EmptyState title="Nothing delegated" description={`Nobody holds delegated access in ${department.name}'s modules.`} />
        ) : (
          <div className="nesto-card overflow-x-auto">
            <table className="w-full text-left text-table" aria-label="Delegated access">
              <thead className="text-meta text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 font-medium">Module</th>
                  <th className="px-4 py-2 font-medium">Where</th>
                  <th className="px-4 py-2 font-medium">Level</th>
                  <th className="px-4 py-2 font-medium">Until</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {grants.map((grant) => (
                  <tr key={grant.id}>
                    <td className="px-4 py-2">{grant.holder.name}</td>
                    <td className="px-4 py-2">{grant.module.label}</td>
                    <td className="px-4 py-2">{grant.scope.company?.name ?? "The whole group"}</td>
                    <td className="px-4 py-2">{grant.accessLevel.charAt(0) + grant.accessLevel.slice(1).toLowerCase()}</td>
                    <td className="px-4 py-2">{dateOf(grant.expiresAt) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      <Link href="/organization/access" className="text-table text-accent-strong hover:underline">
        Open Access &amp; roles
      </Link>
    </section>
  );
}

async function Activity({ context, department }: { context: UserContext; department: DepartmentDetailDTO }) {
  const events = await getDepartmentActivity(memberActor(context), department.id);
  return events.length === 0 ? (
    <EmptyState title="Nothing yet" description="Changes to this department will show here." />
  ) : (
    <ol className="nesto-card divide-y divide-line" aria-label="Department activity">
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" data-testid="department-activity">
          <span className="text-table text-fg">{event.text}</span>
          <span className="text-meta text-fg-subtle">
            {event.actor ? `${event.actor} · ` : ""}
            <time dateTime={event.at}>{new Date(event.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
          </span>
        </li>
      ))}
    </ol>
  );
}
