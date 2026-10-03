import Link from "@/components/navigation/nav-link";

import { EntitlementControl } from "@/components/3d/platform/EntitlementControl";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { EntitlementEditor } from "@/components/platform/entitlement-editor";
import { AddCompanyToGroup } from "@/components/platform/organization-create";
import { AddOrganizationUser, OrganizationMemberActions } from "@/components/platform/organization-users";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { getCompanyEntitlements, listEntitlementPlans } from "@/lib/modules/entitlements/entitlement.service";
import {
  organizationCompanies, organizationMember, organizationModules, organizationProjectOptions, organizationProjects, organizationRoles, organizationUsage, organizationUsers, type OrganizationScope,
} from "@/lib/modules/platform/platform-organization-detail.query";
import { attachableCompanies } from "@/lib/modules/platform/platform-organizations.query";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatRelativeTime } from "@/lib/utils/format";

/*
 * The tabs shared by group and company pages (Organizations PRD §24-§41;
 * Organization-Scoped PRD #7). Server components: each reads its own data,
 * scoped on the server to this organization, only when it is the open tab.
 * Everything a tab manages is managed here; a link to a global page says so.
 */

type Params = Record<string, string | undefined>;
type Org = { id: string; name: string; open: boolean };

const bytes = (value: number) => value < 1024 ** 2 ? `${Math.round(value / 1024)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`;
const tabHref = (org: Org, tab: string, extra: Params = {}) => {
  const params = new URLSearchParams(Object.entries({ tab, ...extra }).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return `/admin/organizations/${org.id}?${params}`;
};
const fieldClass = "h-9 rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

function Card({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="nesto-card overflow-hidden" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-card font-semibold text-fg">{title}</h2>
          {description ? <p className="text-table text-fg-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const companiesOf = async (context: PlatformContext, scope: OrganizationScope, org: Org) =>
  scope.kind === "group" ? (await organizationCompanies(context, scope.groupId)).filter((row) => row.status === "ACTIVE").map((row) => ({ value: row.id, label: row.name })) : [{ value: scope.companyId, label: org.name }];

const roleOptions = (roles: Awaited<ReturnType<typeof organizationRoles>>["roles"]) => roles.filter((row) => !row.groupLevel).map((row) => ({ value: row.key, label: row.name }));

export async function GroupCompaniesTab({ context, group }: { context: PlatformContext; group: Org }) {
  const [rows, standalone] = await Promise.all([organizationCompanies(context, group.id), attachableCompanies(context)]);
  const add = group.open ? <AddCompanyToGroup group={{ value: group.id, label: group.name }} standalone={standalone} /> : null;
  return (
    <Card title="Companies" description={`The companies of ${group.name}. Open one to manage it.`} action={add}>
      {rows.length === 0 ? (
        <EmptyState className="m-4" title="No Companies in this Group." description="Create a new Company or add an existing standalone Company with Add Company." />
      ) : (
        <div className="overflow-x-auto">
          <Table stack flush aria-label="Companies">
            <TableHead><TableRow><TableHeaderCell>Company</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Projects</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Users</TableHeaderCell><TableHeaderCell className="max-md:hidden">Modules</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="group-company">
                  <TableCell><Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.slug}</p></TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{row.projects}</TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{row.users}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.modules}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/** Projects of this organization; a new one starts with this company already chosen (§33-§37, §106). */
export async function ProjectsTab({ context, scope, org }: { context: PlatformContext; scope: OrganizationScope; org: Org }) {
  const [rows, companies] = await Promise.all([organizationProjects(context, scope), companiesOf(context, scope, org)]);
  const canCreate = org.open && canPlatform(context, "platform.project.manage") && companies.length > 0;
  const add = canCreate ? (
    <PlatformCommandButton
      label="+ Add Project"
      title={`Add Project to ${org.name}`}
      description={scope.kind === "company" ? `Managing company: ${org.name}.` : "Choose which of the group's companies manages it."}
      action="project.create"
      fixed={scope.kind === "company" ? { companyId: scope.companyId } : {}}
      fields={[
        ...(scope.kind === "group" ? [{ name: "companyId", label: "Managing Company", type: "select" as const, required: true, options: companies }] : []),
        { name: "name", label: "Project name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", hint: "Leave blank to make one from the name." },
        { name: "description", label: "Description", type: "textarea" },
      ]}
      variant="primary"
      submitLabel="Create Project"
      success="Project created."
    />
  ) : null;
  return (
    <Card title="Projects" description={`Projects managed by ${org.name}${scope.kind === "group" ? "'s companies" : ""}.`} action={add}>
      {rows.length === 0 ? (
        <EmptyState className="m-4" title="No Projects yet." description={`Create a Project for ${org.name}. A NESTO project has one managing company, so an existing project of another company cannot be associated here.`} />
      ) : (
        <div className="overflow-x-auto">
          <Table stack flush aria-label="Projects">
            <TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell>{scope.kind === "group" ? <TableHeaderCell className="max-sm:hidden">Managing Company</TableHeaderCell> : <TableHeaderCell className="max-sm:hidden">Role</TableHeaderCell>}<TableHeaderCell className="max-md:hidden">Users</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell className="max-sm:hidden">3D</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="org-project">
                  <TableCell><Link href={`/admin/projects/${row.id}?from=${org.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell>
                  <TableCell className="max-sm:hidden">{scope.kind === "group" ? <Link href={`/admin/organizations/${row.company.id}?tab=projects`} className="hover:underline">{row.company.name}</Link> : "Managing"}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.users}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  <TableCell className="max-sm:hidden"><AdminStatusBadge status={row.threeD} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/**
 * The organization's users, managed here (§10-§24): search and filters stay
 * inside the organization, Add User knows the company, and each row's actions
 * change this membership only.
 */
export async function UsersTab({ context, scope, org, params }: { context: PlatformContext; scope: OrganizationScope; org: Org; params: Params }) {
  if (params.member) return <MemberPanel context={context} scope={scope} org={org} membershipId={params.member} />;
  const [{ filter, rows }, { roles }, projects, companies] = await Promise.all([organizationUsers(context, scope, params), organizationRoles(context, scope), organizationProjectOptions(context, scope), companiesOf(context, scope, org)]);
  const canManage = org.open && canPlatform(context, "platform.membership.manage");
  const assignable = roleOptions(roles);
  const filtered = Boolean(filter.q || filter.role || filter.project || filter.status || filter.company);
  const add = canManage && companies.length ? <AddOrganizationUser organizationName={org.name} companies={companies} roles={assignable} projects={projects} /> : null;
  return (
    <Card title="Users" description={`Manage user access for ${org.name}.`} action={add}>
      <form method="get" action={`/admin/organizations/${org.id}`} className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3" aria-label="Filter users">
        <input type="hidden" name="tab" value="users" />
        <input name="q" defaultValue={filter.q} placeholder="Search users..." aria-label="Search users" className={cn(fieldClass, "min-w-48 flex-1")} />
        <select name="role" defaultValue={filter.role} aria-label="Role" className={fieldClass}><option value="">Any role</option>{roles.map((row) => <option key={row.key} value={row.key}>{row.name}</option>)}</select>
        <select name="project" defaultValue={filter.project} aria-label="Project" className={fieldClass}><option value="">Any project</option>{projects.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select>
        <select name="status" defaultValue={filter.status} aria-label="Status" className={fieldClass}><option value="">Any status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Removed</option><option value="SUSPENDED">Suspended</option><option value="INVITED">Invited</option></select>
        {scope.kind === "group" ? <select name="company" defaultValue={filter.company} aria-label="Company" className={fieldClass}><option value="">Any company</option>{companies.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select> : null}
        <button type="submit" className="h-9 rounded-lg border border-line px-3 text-table font-medium text-fg hover:bg-hover">Apply</button>
        {filtered ? <Link href={tabHref(org, "users")} className="h-9 px-2 text-table leading-9 text-fg-muted hover:text-fg">Clear</Link> : null}
      </form>
      {rows.length === 0 ? (
        filtered ? <NoResultsState className="m-4" noun="users" clearHref={tabHref(org, "users")} /> : (
          <div className="m-4 space-y-3 text-center"><EmptyState title="No users yet." description={`Add an existing NESTO user or create an account for this ${scope.kind === "group" ? "Group" : "Company"}. Employees without a login are not users.`} />{add}</div>
        )
      ) : (
        <div className="overflow-x-auto">
          <Table stack flush aria-label="Users">
            <TableHead><TableRow><TableHeaderCell>User</TableHeaderCell><TableHeaderCell>Role</TableHeaderCell>{scope.kind === "group" ? <TableHeaderCell className="max-md:hidden">Company</TableHeaderCell> : null}<TableHeaderCell className="max-md:hidden">Projects</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="org-user">
                  <TableCell>
                    {row.membershipId ? <Link href={tabHref(org, "users", { member: row.membershipId })} className="font-medium text-fg hover:underline">{row.name}</Link> : <span className="font-medium text-fg">{row.name}</span>}
                    <p className="font-mono text-micro text-fg-subtle">{row.email ?? row.username}</p>
                  </TableCell>
                  <TableCell>{row.role}</TableCell>
                  {scope.kind === "group" ? <TableCell className="max-md:hidden">{row.company ? <Link href={`/admin/organizations/${row.company.id}?tab=users`} className="hover:underline">{row.company.name}</Link> : "All companies"}</TableCell> : null}
                  <TableCell className="tabular-nums max-md:hidden">{row.membershipId ? row.projects.length : "—"}</TableCell>
                  <TableCell><AdminStatusBadge status={row.account !== "ACTIVE" ? row.account : row.membership} /></TableCell>
                  <TableCell className="text-right">
                    {row.membershipId && row.company && row.roleKey && canManage ? (
                      <OrganizationMemberActions companyId={row.company.id} companyName={row.company.name} member={{ id: row.membershipId, name: row.name, roleKey: row.roleKey, projectIds: row.projects.map((project) => project.id), active: row.membership === "ACTIVE" }} roles={assignable} projects={projects} detailHref={tabHref(org, "users", { member: row.membershipId })} accountHref={`/admin/users/${row.userId}?from=${org.id}`} />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/** One user as this organization sees them (§23, §24); the platform account is one explicit link away. */
async function MemberPanel({ context, scope, org, membershipId }: { context: PlatformContext; scope: OrganizationScope; org: Org; membershipId: string }) {
  const [member, { roles }, projects] = await Promise.all([organizationMember(context, scope, membershipId), organizationRoles(context, scope), organizationProjectOptions(context, scope)]);
  if (!member) return <EmptyState className="nesto-card p-6" title="This user is not part of this organization." action={{ label: "Back to Users", href: tabHref(org, "users") }} />;
  const canManage = org.open && canPlatform(context, "platform.membership.manage");
  return (
    <section className="nesto-card p-5" aria-label={member.user.name} data-testid="org-member">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={tabHref(org, "users")} className="text-table text-fg-muted hover:text-fg">← Users</Link>
          <h2 className="mt-1 text-card font-semibold text-fg">{member.user.name}</h2>
          <p className="font-mono text-meta text-fg-subtle">{member.user.email ?? member.user.username}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/users/${member.user.id}?from=${org.id}`} className="text-table font-medium text-accent-strong hover:underline">View platform account →</Link>
          {canManage ? <OrganizationMemberActions companyId={member.company.id} companyName={member.company.name} member={{ id: member.id, name: member.user.name, roleKey: member.roleKey, projectIds: member.projects.map((project) => project.id), active: member.status === "ACTIVE" }} roles={roleOptions(roles)} projects={projects} detailHref={tabHref(org, "users", { member: member.id })} accountHref={`/admin/users/${member.user.id}?from=${org.id}`} /> : null}
        </div>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ["Company", member.company.name],
          ["Role", member.role],
          ["Department", member.department ?? "—"],
          ["Status here", member.status === "INACTIVE" ? "Removed" : member.status.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())],
          ["Account", member.user.status.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())],
          ["Joined", member.joinedAt ? formatDate(member.joinedAt) : "—"],
          ["Last sign-in", member.user.lastLoginAt ? formatRelativeTime(member.user.lastLoginAt) : "Never"],
        ] as const).map(([label, value]) => <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{value}</dd></div>)}
      </dl>
      <h3 className="mt-5 text-table font-semibold text-fg">Projects</h3>
      {member.projects.length === 0 ? <p className="mt-1 text-table text-fg-muted">No projects in {member.company.name}.</p> : (
        <ul className="mt-1 divide-y divide-line text-table">{member.projects.map((project) => <li key={project.id} className="flex justify-between gap-2 py-1.5"><Link href={`/admin/projects/${project.id}?from=${org.id}`} className="text-fg hover:underline">{project.name}</Link><span className="text-fg-muted">{project.role ?? ""}</span></li>)}</ul>
      )}
      <p className="mt-4 text-meta text-fg-subtle">Suspending the account, sessions and passwords are on the platform account, because they affect every organization.</p>
    </section>
  );
}

/**
 * NESTO's role catalogue in this organization (§25-§32): who holds each role
 * here. Roles are assigned, never redefined; a role's detail lists its holders
 * and moves a member into it, within this scope only.
 */
export async function RolesTab({ context, scope, org, params }: { context: PlatformContext; scope: OrganizationScope; org: Org; params: Params }) {
  const { roles, groupSeats } = await organizationRoles(context, scope).catch(() => ({ roles: [], groupSeats: 0 }));
  if (roles.length === 0) return <EmptyState className="nesto-card p-6" title="Unable to load NESTO roles." action={{ label: "Try Again", href: tabHref(org, "roles") }} />;
  const selected = roles.find((row) => row.key === params.role);
  if (selected) return <RoleDetail context={context} scope={scope} org={org} role={selected} roles={roles} />;
  return (
    <Card title="Roles" description={`Roles available within ${org.name}. They come from NESTO's role catalogue; what each may do is defined there.`}>
      <ul className="divide-y divide-line">
        {roles.map((row) => (
          <li key={row.key}>
            <Link href={tabHref(org, "roles", { role: row.key })} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-hover" data-testid="org-role">
              <span className="min-w-0"><span className="block text-body text-fg">{row.name}{row.groupLevel ? <span className="ml-2 text-meta text-fg-subtle">group level</span> : null}</span><span className="block truncate text-meta text-fg-subtle max-sm:hidden">{row.description}</span></span>
              <span className="shrink-0 text-table tabular-nums text-fg-muted">{row.users} {row.users === 1 ? "user" : "users"}</span>
            </Link>
          </li>
        ))}
      </ul>
      {scope.kind === "group" ? <p className="border-t border-line px-5 py-3 text-meta text-fg-subtle">{groupSeats} group-level {groupSeats === 1 ? "seat" : "seats"}. Heads of group departments are appointed in <Link href={`/admin/organizations/${org.id}/departments`} className="text-accent-strong hover:underline">Departments</Link>.</p> : null}
    </Card>
  );
}

async function RoleDetail({ context, scope, org, role, roles }: { context: PlatformContext; scope: OrganizationScope; org: Org; role: Awaited<ReturnType<typeof organizationRoles>>["roles"][number]; roles: Awaited<ReturnType<typeof organizationRoles>>["roles"] }) {
  const [{ rows }, projects, companies] = await Promise.all([organizationUsers(context, scope, { role: role.key, status: "ACTIVE" }), organizationProjectOptions(context, scope), companiesOf(context, scope, org)]);
  const canManage = org.open && canPlatform(context, "platform.membership.manage") && !role.groupLevel;
  const assignable = roleOptions(roles);
  return (
    <Card
      title={role.name}
      description={`${rows.length} ${rows.length === 1 ? "user" : "users"} assigned in ${org.name}. ${role.description}`}
      action={canManage && companies.length ? <AddOrganizationUser organizationName={org.name} companies={companies} roles={assignable.filter((row) => row.value === role.key)} projects={projects} label="Assign User" /> : null}
    >
      <div className="border-b border-line px-5 py-2"><Link href={tabHref(org, "roles")} className="text-table text-fg-muted hover:text-fg">← Roles</Link></div>
      {role.groupLevel ? <p className="border-b border-line px-5 py-3 text-table text-fg-muted">A group-level role is held in every company of the group. It is given when the group is implemented, not from here.</p> : null}
      {rows.length === 0 ? <EmptyState className="m-4" title={`Nobody holds ${role.name} here yet.`} /> : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-2.5" data-testid="org-role-holder">
              <span><Link href={tabHref(org, "users", { member: row.membershipId ?? undefined })} className="text-body text-fg hover:underline">{row.name}</Link>{row.company && scope.kind === "group" ? <span className="block text-meta text-fg-subtle">{row.company.name}</span> : null}</span>
              {canManage && row.membershipId && row.company && row.roleKey ? <OrganizationMemberActions companyId={row.company.id} companyName={row.company.name} member={{ id: row.membershipId, name: row.name, roleKey: row.roleKey, projectIds: row.projects.map((project) => project.id), active: true }} roles={assignable} projects={projects} detailHref={tabHref(org, "users", { member: row.membershipId })} accountHref={`/admin/users/${row.userId}?from=${org.id}`} /> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-5 py-3 text-meta text-fg-subtle">A membership holds one role in its company. Assign User adds someone with this role; to take the role away, change their role or remove them from the company.</p>
    </Card>
  );
}

/**
 * The company's own entitlements, edited here with the same engine as the
 * Modules area (§38-§43); a group shows each company's, one link each, since
 * modules are granted company by company.
 */
export async function ModulesTab({ context, scope, org }: { context: PlatformContext; scope: OrganizationScope; org: Org }) {
  if (scope.kind === "group") {
    const [{ companies, modules }, rows] = await Promise.all([organizationModules(context, scope), organizationCompanies(context, scope.groupId)]);
    return (
      <div className="space-y-5">
        <Card title="Modules" description={`Modules are granted company by company. ${modules.filter((row) => row.enabledIn > 0).length} of ${modules.length} are on in at least one of the ${companies} companies.`}>
          <ul className="divide-y divide-line">
            {modules.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 px-5 py-2.5"><span className="text-body text-fg">{row.name}</span><span className="shrink-0 text-table tabular-nums text-fg-muted">{row.enabledIn} / {companies} companies</span></li>
            ))}
          </ul>
        </Card>
        {rows.length ? (
          <Card title="Edit a company's modules">
            <ul className="divide-y divide-line">{rows.map((row) => <li key={row.id}><Link href={`/admin/organizations/${row.id}?tab=modules`} className="flex items-center justify-between px-5 py-2.5 text-table hover:bg-hover"><span className="text-fg">{row.name}</span><span className="text-fg-muted">{row.modules} modules on</span></Link></li>)}</ul>
          </Card>
        ) : null}
      </div>
    );
  }
  const [data, plans] = await Promise.all([getCompanyEntitlements(context, scope.companyId), listEntitlementPlans(context)]);
  const canManage = canPlatform(context, "platform.module.manage");
  const options = plans.filter((plan) => plan.status === "ACTIVE" || plan.id === data.plan.id).map((plan) => ({ value: plan.id, label: plan.name }));
  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-label="Modules">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-table text-fg-muted">What {org.name} may use. The company&apos;s administrators decide how it is used; each user still needs the permission.</p>
          <Link href={`/admin/modules/${scope.companyId}?tab=history`} className="text-table font-medium text-accent-strong hover:underline">Open Global Entitlement History →</Link>
        </div>
        {data.company.status !== "ACTIVE" ? <p className="text-meta text-fg-subtle">The company is {data.company.status.toLowerCase()}: its entitlements are kept and apply again when it is reactivated.</p> : null}
        <EntitlementEditor companyId={scope.companyId} version={data.version} plan={data.plan} plans={options} modules={data.modules} canManage={canManage} />
      </section>
      <Card title="Project-controlled modules" description="The 3D Viewer is granted project by project.">
        {data.projects.length === 0 ? <EmptyState className="m-4" title="No Projects yet." /> : (
          <div className="overflow-x-auto">
            <Table stack flush aria-label="Project entitlements">
              <TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell>3D Viewer</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
              <TableBody>
                {data.projects.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}<p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell>
                    <TableCell><AdminStatusBadge status={row.viewer3d?.status === "ACTIVE" && row.viewer3d.viewerEnabled ? "Enabled" : "Disabled"} /></TableCell>
                    <TableCell>{canPlatform(context, "platform.3d.configure") ? <EntitlementControl projectId={row.id} entitlement={row.viewer3d} compact /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Only what NESTO measures (§44, §45); a company shows its limits, a group counts each person once. */
export async function UsageTab({ context, scope }: { context: PlatformContext; scope: OrganizationScope }) {
  const [usage, limits] = await Promise.all([
    organizationUsage(context, scope),
    scope.kind === "company" && canPlatform(context, "platform.module.view") ? getCompanyEntitlements(context, scope.companyId).then((data) => data.limits) : Promise.resolve(null),
  ]);
  const of = (value: number, limit: number | null | undefined) => (limit === null || limit === undefined ? String(value) : `${value} / ${limit}`);
  const items: [string, string | number][] = [
    ...(scope.kind === "group" ? [["Companies", usage.companies] as [string, number]] : []),
    ["Users", of(usage.users, limits?.maxActiveUsers)], ["Projects", of(usage.projects, limits?.maxProjects)], ["Modules enabled", usage.modules],
    ["Storage", `${bytes(usage.storageBytes)}${limits?.maxStorageBytes ? ` / ${bytes(limits.maxStorageBytes)}` : ""} · ${usage.files} files`], ["3D experiences", usage.experiences],
  ];
  return (
    <Card title="Usage" description={scope.kind === "group" ? "Across the group's companies; a person in several companies counts once." : undefined}>
      <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-card font-semibold tabular-nums text-fg">{value}</dd></div>
        ))}
      </dl>
    </Card>
  );
}
