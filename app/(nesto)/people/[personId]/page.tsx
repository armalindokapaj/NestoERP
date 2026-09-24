import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { DetailGrid } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { EmployeeDocuments } from "@/components/hr/employee-documents";
import { EmploymentTimeline } from "@/components/hr/employment-timeline";
import { PersonLink } from "@/components/people/person-link";
import { AssignProjectButton, RemoveFromProjectButton } from "@/components/people/person-project-actions";
import { PersonQualifications } from "@/components/people/person-qualifications";
import { ProfilePhotoButton } from "@/components/people/profile-photo";
import { EditOwnProfileButton, ManageProfileButton } from "@/components/people/work-profile-editor";
import { WorkerWorkforce } from "@/components/workforce/worker-workforce";
import { WORK_STATUS } from "@/components/people/work-status";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { getPersonEmploymentHistory } from "@/lib/modules/hr/employment/employment.query";
import { getAccessSummary, getDocumentsTab, getEmploymentView, getPrivateProfile, getQualificationsTab, getWorkProfile } from "@/lib/modules/people/people.service";
import type { WorkProfileDTO } from "@/lib/modules/people/people.types";
import { assignableProjects, removableProjectIds } from "@/lib/modules/people/person.projects";
import { personInWorkforce } from "@/lib/modules/workforce/workforce.directory";
import { cn } from "@/lib/utils/cn";
import { formatDate, orDash } from "@/lib/utils/format";
import { statusLabel } from "@/lib/utils/status";

type Props = { params: Promise<{ personId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const TABS = ["overview", "projects", "qualifications", "documents", "workforce", "activity", "employment", "private", "access"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Partial<Record<Tab, string>> = { qualifications: "Skills & qualifications" };

async function load(context: UserContext, personId: string): Promise<WorkProfileDTO> {
  try {
    return await getWorkProfile(context, personId);
  } catch (error) {
    // Another group's person, a candidate and a made-up id look the same (E-01 §170, §182).
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { personId } = await params;
  try {
    const context = await requireModule("people");
    return { title: (await getWorkProfile(context, personId)).name };
  } catch {
    return { title: "Profile" };
  }
}

/**
 * A person's profile (E-01 §12-§13, §159-§171; ADR 0002).
 *
 * Everyone in the group reads the work profile: who they are, where they work,
 * how to reach them, what they work on. The Employment and Private tabs exist
 * only for a reader who may open them, and each is fetched only when opened —
 * the work profile never carries what they hold (§121, §165).
 */
export default async function PersonPage({ params, searchParams }: Props) {
  const { personId } = await params;
  const context = await requireModule("people");
  const profile = await load(context, personId);
  const requested = (await searchParams).tab;
  // Where they work and with whom, for a reader who sees this company's workforce (E-04 §139, E-09 §7).
  const inWorkforce = await personInWorkforce(context, profile.personId);
  // Documents belong to an employment (E-02 §94, ADR 0007): somebody who has never been employed here has none.
  const employed = profile.employingCompany !== null && context.moduleAccess.hr?.enabled === true;
  // A former employee, to a colleague, is who they were and nothing more (E-08 §54, §118).
  const visible: Tab[] = profile.former
    ? ["overview"]
    : TABS.filter((tab) =>
        tab === "employment"
          ? profile.capabilities.canViewEmployment
          : tab === "private"
            ? profile.capabilities.canViewPrivate
            : tab === "workforce"
              ? inWorkforce
              : tab === "documents"
                ? employed
                : tab === "access"
                  ? profile.capabilities.canViewAccess
                  : true,
      );
  const tab: Tab = visible.find((candidate) => candidate === requested) ?? "overview";
  const status = WORK_STATUS[profile.status];
  const editable = {
    personId: profile.personId,
    preferredName: profile.preferredName,
    jobTitle: profile.jobTitle,
    workEmail: profile.workEmail,
    workPhoneExtension: profile.workPhoneExtension,
    officeLocation: profile.officeLocation,
    professionalBio: profile.professionalBio,
  };

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "People", href: "/people" }, { label: profile.name }]} />

      <header className="nesto-card flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <Avatar firstName={profile.initials.firstName} lastName={profile.initials.lastName} src={profile.photoUrl} size="xl" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-page font-semibold text-fg">{profile.name}</h1>
            <Badge tone={status.tone}>{status.label}</Badge>
            {profile.capabilities.isSelf ? <Badge tone="info">You</Badge> : null}
          </div>
          {profile.preferredName ? <p className="text-meta text-fg-subtle">Goes by {profile.preferredName}</p> : null}
          <p className="text-body text-fg">{profile.jobTitle ?? "—"}</p>
          <p className="text-table text-fg-muted">{[profile.employingCompany?.name, profile.department?.name].filter(Boolean).join(" · ") || profile.parentGroup.name}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-table" aria-label="Contact">
            {profile.workEmail ? (
              <a href={`mailto:${profile.workEmail}`} className="text-accent-strong hover:underline">
                {profile.workEmail}
              </a>
            ) : null}
            {profile.workPhone ? (
              <a href={`tel:${profile.workPhone}`} className="text-accent-strong hover:underline">
                {profile.workPhone}
                {profile.workPhoneExtension ? ` ext. ${profile.workPhoneExtension}` : ""}
              </a>
            ) : null}
            {profile.officeLocation ? <span className="text-fg-muted">{profile.officeLocation}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {profile.capabilities.canChangePhoto ? <ProfilePhotoButton personId={profile.personId} self={profile.capabilities.isSelf} hasPhoto={profile.photoUrl !== null} /> : null}
          {profile.capabilities.canEditOwn ? <EditOwnProfileButton profile={editable} /> : null}
          {profile.capabilities.canManage && !profile.capabilities.isSelf ? <ManageProfileButton profile={editable} name={profile.name} /> : null}
        </div>
      </header>

      <nav aria-label="Profile sections" className="border-b border-line">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {visible.map((key) => (
            <li key={key}>
              <Link
                href={key === "overview" ? `/people/${profile.personId}` : `/people/${profile.personId}?tab=${key}`}
                aria-current={key === tab ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors",
                  key === tab ? "border-accent text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {key === "projects" ? `Projects (${profile.projects.filter((project) => project.status === "ACTIVE").length})` : (TAB_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1))}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" ? profile.former ? <Former profile={profile} /> : <Overview profile={profile} /> : null}
      {tab === "projects" ? <Projects context={context} profile={profile} /> : null}
      {tab === "qualifications" ? <Qualifications context={context} personId={profile.personId} name={profile.name} /> : null}
      {tab === "documents" ? <Documents context={context} personId={profile.personId} /> : null}
      {tab === "workforce" ? <WorkerWorkforce context={context} personId={profile.personId} /> : null}
      {tab === "activity" ? <Activity profile={profile} /> : null}
      {tab === "employment" ? <Employment context={context} personId={profile.personId} withHistory={profile.capabilities.canViewHistory} /> : null}
      {tab === "private" ? <Private context={context} personId={profile.personId} /> : null}
      {tab === "access" ? <Access context={context} personId={profile.personId} /> : null}
    </div>
  );
}

function Overview({ profile }: { profile: WorkProfileDTO }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="nesto-card p-5 lg:col-span-2" aria-labelledby="about-heading">
        <h2 id="about-heading" className="text-card font-semibold text-fg">
          About
        </h2>
        <p className="mt-2 whitespace-pre-line text-table text-fg-muted">{profile.professionalBio ?? "Nothing written yet."}</p>

        <h2 className="mt-6 text-card font-semibold text-fg">Organization</h2>
        <DetailGrid
          className="mt-3"
          items={[
            { label: "Group", value: profile.parentGroup.name },
            { label: "Employing company", value: orDash(profile.employingCompany?.name) },
            { label: "Department", value: orDash(profile.department?.name) },
            { label: "NESTO role", value: orDash(profile.role?.label) },
            {
              label: "Reports to",
              value: profile.manager ? <PersonLink personId={profile.manager.personId} name={profile.manager.name} detail={profile.manager.jobTitle} /> : "—",
            },
            ...(profile.groupPositions.length > 0 ? [{ label: "Group positions", value: profile.groupPositions.join(", ") }] : []),
          ]}
        />
      </section>

      {profile.departments.length > 0 ? (
        <section className="nesto-card p-5" aria-labelledby="departments-heading">
          <h2 id="departments-heading" className="text-card font-semibold text-fg">
            Departments
          </h2>
          <ul className="mt-3 space-y-1.5" data-testid="person-departments">
            {profile.departments.map((place) => (
              <li key={`${place.department.id}:${place.company?.id ?? "group"}:${place.position}`} className="text-table">
                <Link href={`/organization/departments/${encodeURIComponent(place.department.id)}`} className="font-medium text-fg hover:text-accent-strong hover:underline">
                  {place.department.name}
                </Link>
                <span className="text-fg-muted">
                  {" · "}
                  {place.company?.name ?? "the whole group"}
                  {" · "}
                  {place.position === "GROUP_HEAD" ? "Group head" : place.position === "COMPANY_MANAGER" ? "Manager" : "Member"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile.directReports.length > 0 ? (
        <section className="nesto-card p-5" aria-labelledby="reports-heading" data-testid="direct-reports">
          <h2 id="reports-heading" className="text-card font-semibold text-fg">
            Direct reports
          </h2>
          <ul className="mt-3 space-y-1.5">
            {profile.directReports.slice(0, 8).map((report) => (
              <li key={report.personId} className="text-table">
                <PersonLink personId={report.personId} name={report.name} detail={report.jobTitle} />
                <span className="text-fg-muted"> · {[report.jobTitle, report.company].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
          {profile.directReports.length > 8 ? (
            <Link href={`/people?manager=${encodeURIComponent(profile.personId)}`} className="mt-3 inline-block text-meta text-accent-strong hover:underline">
              All {profile.directReports.length} in the directory
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="nesto-card p-5" aria-labelledby="companies-heading">
        <h2 id="companies-heading" className="text-card font-semibold text-fg">
          Where they work
        </h2>
        {profile.companies.length === 0 ? (
          <p className="mt-2 text-table text-fg-subtle">No NESTO account yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {profile.companies.map((placement) => (
              <li key={placement.company.id} className="text-table">
                <p className="font-medium text-fg">{placement.company.name}</p>
                <p className="text-fg-muted">{[placement.jobTitle, placement.department].filter(Boolean).join(" · ") || "—"}</p>
                <p className="text-meta text-fg-subtle">
                  {placement.role.label}
                  {placement.positions.length > 0 ? ` · ${placement.positions.join(", ")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A former employee as a colleague sees them (E-08 §54, §55, §118): the records they left still lead here. */
function Former({ profile }: { profile: WorkProfileDTO }) {
  return (
    <section className="nesto-card p-5" aria-labelledby="former-heading" data-testid="former-profile">
      <h2 id="former-heading" className="text-card font-semibold text-fg">
        No longer with the group
      </h2>
      <p className="mt-2 text-table text-fg-muted">
        {profile.name} no longer works here{profile.employingCompany ? `; they were with ${profile.employingCompany.name}` : ""}
        {profile.jobTitle ? ` as ${profile.jobTitle}` : ""}. Tasks, comments and documents they worked on still lead to this page.
      </p>
    </section>
  );
}

/** The person's projects, and — for a department manager or a project's team lead — putting them on one or taking them off (§49, §64). */
async function Projects({ context, profile }: { context: UserContext; profile: WorkProfileDTO }) {
  const [assignable, removable] = profile.former ? [[], []] : await Promise.all([assignableProjects(context, profile.personId), removableProjectIds(context, profile.personId)]);
  const canRemove = new Set(removable);
  const assign = assignable.length > 0 ? <AssignProjectButton personId={profile.personId} name={profile.name} projects={assignable} /> : null;
  if (profile.projects.length === 0)
    return (
      <div className="space-y-3">
        {assign ? <div className="flex justify-end">{assign}</div> : null}
        <EmptyState title="No projects assigned" description="Projects appear here when somebody is added to a project team." />
      </div>
    );
  return (
    <div className="space-y-3">
      {assign ? <div className="flex justify-end">{assign}</div> : null}
      <div className="nesto-card p-0">
        <Table flush aria-label="Projects">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Project</TableHeaderCell>
              <TableHeaderCell>Company</TableHeaderCell>
              <TableHeaderCell>Role on the project</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Since</TableHeaderCell>
              {canRemove.size > 0 ? <TableHeaderCell className="w-24" aria-label="Actions" /> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {profile.projects.map((project) => (
              <TableRow key={`${project.company.id}:${project.code}`} data-testid="person-project">
                <TableCell className="font-medium">
                  {project.href ? (
                    <Link href={project.href} className="text-fg hover:text-accent-strong hover:underline">
                      {project.code} · {project.name}
                    </Link>
                  ) : (
                    <span>
                      {project.code} · {project.name}
                    </span>
                  )}
                </TableCell>
                <TableCell>{project.company.name}</TableCell>
                <TableCell>{orDash(project.projectRole)}</TableCell>
                <TableCell>
                  <StatusBadge status={project.status} />
                </TableCell>
                <TableCell>{project.joinedAt ? formatDate(project.joinedAt) : "—"}</TableCell>
                {canRemove.size > 0 ? (
                  <TableCell>
                    {project.projectId && project.status === "ACTIVE" && canRemove.has(project.projectId) ? (
                      <RemoveFromProjectButton personId={profile.personId} name={profile.name} project={{ id: project.projectId, name: project.name }} />
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Activity({ profile }: { profile: WorkProfileDTO }) {
  if (profile.activity.length === 0) return <EmptyState title="No recent activity" description="Project assignments, appointments and verified qualifications appear here." />;
  return (
    <ol className="nesto-card divide-y divide-line p-0" aria-label="Activity">
      {profile.activity.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="flex items-baseline justify-between gap-3 px-5 py-3 text-table">
          <span className="text-fg">{entry.text}</span>
          <time dateTime={entry.at} className="shrink-0 text-meta text-fg-subtle">
            {formatDate(entry.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

/**
 * Employment (E-01 §98; E-03 §54, §57, §58, §160, §161): each employment as HR
 * lets this reader see it, and — for the person themselves and for HR in scope —
 * the organization history across the group's companies, newest first.
 */
async function Employment({ context, personId, withHistory }: { context: UserContext; personId: string; withHistory: boolean }) {
  const [employments, history] = await Promise.all([
    getEmploymentView(context, personId),
    withHistory ? getPersonEmploymentHistory(context, personId).catch((error) => (error instanceof AccessError ? null : Promise.reject(error))) : Promise.resolve(null),
  ]);
  return (
    <div className="space-y-4">
      {history ? (
        <section className="nesto-card p-5" aria-labelledby="organization-history" data-testid="organization-history">
          <h2 id="organization-history" className="text-card font-semibold text-fg">
            Organization history
          </h2>
          <p className="mt-1 text-meta text-fg-subtle">
            {history.isSelf ? "Your positions, companies, departments and managers over time." : "Positions, companies, departments and managers over time, as HR records them."}
          </p>
          <div className="mt-4">
            <EmploymentTimeline events={history.timeline} showCompany={history.employments.length > 1} />
          </div>
        </section>
      ) : null}
      {employments.map((employment) => (
        <section key={employment.id} className="nesto-card p-5" data-testid="employment-record">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-card font-semibold text-fg">{employment.company.legalName ?? employment.company.name}</h2>
            <StatusBadge status={employment.status} />
          </div>
          <DetailGrid
            className="mt-3"
            items={[
              { label: "Registration number", value: orDash(employment.company.registrationNumber) },
              { label: "Employee number", value: orDash(employment.employeeNumber) },
              { label: "Job title", value: orDash(employment.jobTitle) },
              { label: "Department", value: orDash(employment.department) },
              { label: "Employment type", value: statusLabel(employment.type) },
              { label: "Started", value: employment.startDate ? formatDate(employment.startDate) : "—" },
              { label: "Probation ends", value: employment.probationEndDate ? formatDate(employment.probationEndDate) : "—" },
              { label: "Ends", value: employment.endDate ? formatDate(employment.endDate) : "—" },
              { label: "Work location", value: orDash(employment.workLocation) },
              { label: "Manager", value: orDash(employment.manager) },
            ]}
          />
          {employment.hrHref || employment.compensationHref ? (
            <p className="mt-4 flex gap-4 border-t border-line pt-3 text-table">
              {employment.hrHref ? (
                <Link href={employment.hrHref} className="font-medium text-accent-strong hover:underline">
                  Open in HR
                </Link>
              ) : null}
              {employment.compensationHref ? (
                <Link href={employment.compensationHref} className="font-medium text-accent-strong hover:underline">
                  Compensation
                </Link>
              ) : null}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** Skills & qualifications (E-02 §100-§105): the person's across the group, as this reader may see them. */
async function Qualifications({ context, personId, name }: { context: UserContext; personId: string; name: string }) {
  return <PersonQualifications data={await getQualificationsTab(context, personId)} name={name} />;
}

/**
 * Documents (E-02 §94-§99): the person's employment files in this company, as
 * the employee-file rules let this reader see them. Files another company of
 * the group keeps are read in that company.
 */
async function Documents({ context, personId }: { context: UserContext; personId: string }) {
  const tab = await getDocumentsTab(context, personId);
  return (
    <div className="space-y-6">
      {tab.employments.length === 0 ? (
        <EmptyState title="No documents available to you" description={tab.elsewhere.length > 0 ? `Their documents are kept by ${tab.elsewhere.join(", ")}. Switch to that company to see what you may.` : "Documents filed for this person appear here."} />
      ) : (
        tab.employments.map((employment, index) => <EmployeeDocuments key={employment.employeeId} data={employment} heading={index === 0 || tab.employments.length > 1} />)
      )}
      {tab.employments.length > 0 && tab.elsewhere.length > 0 ? <p className="text-meta text-fg-subtle">Documents kept by {tab.elsewhere.join(", ")} are read in that company.</p> : null}
    </div>
  );
}

async function Private({ context, personId }: { context: UserContext; personId: string }) {
  const details = await getPrivateProfile(context, personId);
  return (
    <section className="nesto-card p-5" aria-labelledby="private-heading">
      <h2 id="private-heading" className="text-card font-semibold text-fg">
        Private details
      </h2>
      <p className="mt-1 text-meta text-fg-subtle">Seen by the person and by HR only. Changed in HR.</p>
      <DetailGrid
        className="mt-3"
        items={[
          { label: "Personal email", value: orDash(details.personalEmail) },
          { label: "Personal phone", value: orDash(details.personalPhone) },
          { label: "Date of birth", value: details.dateOfBirth ? formatDate(details.dateOfBirth) : "—" },
          { label: "Address", value: orDash([details.address, details.city, details.country].filter(Boolean).join(", ") || null) },
        ]}
      />
    </section>
  );
}

const POSITION_LABEL: Record<string, string> = { GROUP_HEAD: "Group head", COMPANY_MANAGER: "Manager", MEMBER: "Member" };

/**
 * Access (E-08 §29, §53, §66, §97): the person's NESTO account, their places and
 * roles in the group, project access and delegated grants, and how complete
 * their record is — for access administrators only.
 */
async function Access({ context, personId }: { context: UserContext; personId: string }) {
  const access = await getAccessSummary(context, personId);
  const checks: Array<[keyof typeof access.completeness, string]> = [
    ["photo", "Photo"],
    ["workEmail", "Work email"],
    ["company", "Company"],
    ["department", "Department"],
    ["manager", "Manager"],
    ["role", "NESTO role"],
    ["account", "Active account"],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="person-access">
      <section className="nesto-card p-5 lg:col-span-2" aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-card font-semibold text-fg">
          NESTO account
        </h2>
        {access.account ? (
          <DetailGrid
            className="mt-3"
            items={[
              { label: "Username", value: access.account.username },
              { label: "Status", value: <StatusBadge status={access.account.status} /> },
              { label: "Created", value: formatDate(access.account.createdAt) },
              ...(access.showsLastLogin ? [{ label: "Last sign-in", value: access.account.lastLoginAt ? formatDate(access.account.lastLoginAt) : "Never" }] : []),
              ...(access.account.mustChangePassword ? [{ label: "Password", value: "Must be changed at the next sign-in" }] : []),
            ]}
          />
        ) : (
          <p className="mt-2 text-table text-fg-muted">
            Not active — no NESTO account.
            {access.provisioning ? ` An account request for ${access.provisioning.company} is ${statusLabel(access.provisioning.status).toLowerCase()}.` : ""}
            {access.provisioning?.href ? (
              <>
                {" "}
                <Link href={access.provisioning.href} className="text-accent-strong hover:underline">
                  Open the request
                </Link>
              </>
            ) : null}
          </p>
        )}

        <h2 className="mt-6 text-card font-semibold text-fg">Companies and roles</h2>
        {access.memberships.length === 0 ? (
          <p className="mt-2 text-table text-fg-subtle">No company access.</p>
        ) : (
          <Table flush aria-label="Company access" className="mt-2">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Company</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Department</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Since</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {access.memberships.map((membership) => (
                <TableRow key={membership.company.id}>
                  <TableCell className="font-medium">{membership.company.name}</TableCell>
                  <TableCell>{membership.role.label}</TableCell>
                  <TableCell>{orDash(membership.department)}</TableCell>
                  <TableCell>
                    <StatusBadge status={membership.status} />
                  </TableCell>
                  <TableCell>{formatDate(membership.since)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <h2 className="mt-6 text-card font-semibold text-fg">Project access</h2>
        {access.projects.length === 0 ? (
          <p className="mt-2 text-table text-fg-subtle">On no project team.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-table">
            {access.projects.map((project) => (
              <li key={`${project.company}:${project.code}`}>
                <span className="font-medium text-fg">
                  {project.code} · {project.name}
                </span>
                <span className="text-fg-muted"> · {[project.company, project.role, statusLabel(project.status)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="space-y-4">
        <section className="nesto-card p-5" aria-labelledby="completeness-heading">
          <h2 id="completeness-heading" className="text-card font-semibold text-fg">
            Record
          </h2>
          <ul className="mt-3 space-y-1 text-table" data-testid="profile-completeness">
            {checks.map(([key, label]) => (
              <li key={key} className={access.completeness[key] ? "text-fg" : "text-fg-subtle"}>
                {access.completeness[key] ? "✓" : "–"} {label}
              </li>
            ))}
          </ul>
        </section>
        <section className="nesto-card p-5" aria-labelledby="positions-heading">
          <h2 id="positions-heading" className="text-card font-semibold text-fg">
            Department positions
          </h2>
          {access.positions.length === 0 ? (
            <p className="mt-2 text-table text-fg-subtle">None.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-table">
              {access.positions.map((position, index) => (
                <li key={index}>
                  {position.department} · {position.company ?? "the whole group"} · {POSITION_LABEL[position.position] ?? position.position}
                </li>
              ))}
            </ul>
          )}
          <h2 className="mt-5 text-card font-semibold text-fg">Delegated access</h2>
          {access.grants.length === 0 ? (
            <p className="mt-2 text-table text-fg-subtle">No grants.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-table">
              {access.grants.map((grant, index) => (
                <li key={index}>
                  {[grant.functionKey ?? "Every function", statusLabel(grant.scopeType), statusLabel(grant.accessLevel)].join(" · ")}
                  {grant.expiresAt ? <span className="text-fg-muted"> · until {formatDate(grant.expiresAt)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
