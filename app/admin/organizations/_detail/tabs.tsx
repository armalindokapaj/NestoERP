import { adminRoleName } from "@/components/platform/admin-roles";
import Link from "@/components/navigation/nav-link";

import { EntitlementControl } from "@/components/3d/platform/EntitlementControl";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { EntitlementEditor } from "@/components/platform/entitlement-editor";
import { AddCompanyToGroup } from "@/components/platform/organization-create";
import { AddGroupUser, GroupPersonActions } from "@/components/platform/group-users";
import { AddOrganizationUser, OrganizationMemberActions } from "@/components/platform/organization-users";
import { LinkRow } from "@/components/platform/link-row";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { getCompanyEntitlements, listEntitlementPlans } from "@/lib/modules/entitlements/entitlement.service";
import {
  organizationCompanies, organizationMember, organizationModules, organizationProjectOptions, organizationProjects, organizationRoles, organizationUsage, organizationUsers, groupPeople, type OrganizationScope,
} from "@/lib/modules/platform/platform-organization-detail.query";
import { attachableCompanies } from "@/lib/modules/platform/platform-organizations.query";
import { cn } from "@/lib/utils/cn";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, formatRelativeTime } from "@/lib/utils/format";
import { statusLabel, statusWord } from "./labels";

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

const roleOptions = (roles: Awaited<ReturnType<typeof organizationRoles>>["roles"], tr: Awaited<ReturnType<typeof getTranslations<"roles">>>) => roles.filter((row) => !row.groupLevel).map((row) => ({ value: row.key, label: adminRoleName(tr, row.name) }));

export async function GroupCompaniesTab({ context, group }: { context: PlatformContext; group: Org }) {
  const t = await getTranslations("adminOrgs");
  const [rows, standalone] = await Promise.all([organizationCompanies(context, group.id), attachableCompanies(context)]);
  const add = group.open ? <AddCompanyToGroup group={{ value: group.id, label: group.name }} standalone={standalone} /> : null;
  return (
    <Card title={t("tabs.companies.title")} description={t("tabs.companies.description", { name: group.name })} action={add}>
      {rows.length === 0 ? (
        <EmptyState className="m-4" title={t("tabs.companies.emptyTitle")} description={t("tabs.companies.emptyBody")} />
      ) : (
        <div className="overflow-x-auto">
          <Table stack aria-label={t("tabs.companies.title")}>
            <TableHead><TableRow><TableHeaderCell>{t("tabs.companies.company")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("common.projects")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("common.users")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("common.modules")}</TableHeaderCell><TableHeaderCell>{t("common.status")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <LinkRow key={row.id} href={`/admin/organizations/${row.id}`} data-testid="group-company">
                  <TableCell><Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.slug}</p></TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{row.projects}</TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{row.users}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.modules}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </LinkRow>
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
  const t = await getTranslations("adminOrgs");
  const [rows, companies] = await Promise.all([organizationProjects(context, scope), companiesOf(context, scope, org)]);
  const canCreate = org.open && canPlatform(context, "platform.project.manage") && companies.length > 0;
  const needCompany = scope.kind === "group" && org.open && companies.length === 0;
  const addCompany = needCompany ? <AddCompanyToGroup group={{ value: org.id, label: org.name }} standalone={await attachableCompanies(context)} /> : null;
  const add = canCreate ? (
    <PlatformCommandButton
      label={t("tabs.projects.add")}
      title={t("tabs.projects.addTitle", { name: org.name })}
      description={scope.kind === "company" ? t("tabs.projects.addDescriptionCompany", { name: org.name }) : t("tabs.projects.addDescriptionGroup")}
      action="project.create"
      fixed={scope.kind === "company" ? { companyId: scope.companyId } : {}}
      fields={[
        ...(scope.kind === "group" ? [{ name: "companyId", label: t("tabs.projects.managingCompany"), type: "select" as const, required: true, options: companies }] : []),
        { name: "name", label: t("common.projectName"), type: "text", required: true },
        { name: "code", label: t("common.code"), type: "text", hint: t("common.codeBlankHint") },
        { name: "description", label: t("common.description"), type: "textarea" },
      ]}
      variant="primary"
      submitLabel={t("tabs.projects.submit")}
      success={t("common.projectCreated")}
    />
  ) : null;
  return (
    <Card title={t("tabs.projects.title")} description={scope.kind === "group" ? t("tabs.projects.descriptionGroup", { name: org.name }) : t("tabs.projects.descriptionCompany", { name: org.name })} action={add ?? addCompany}>
      {rows.length === 0 ? (
        <EmptyState className="m-4" title={t("tabs.projects.emptyTitle")} description={needCompany ? t("tabs.users.needCompany") : t("tabs.projects.emptyBody", { name: org.name })} />
      ) : (
        <div className="overflow-x-auto">
          <Table stack aria-label={t("tabs.projects.title")}>
            <TableHead><TableRow><TableHeaderCell>{t("tabs.projects.project")}</TableHeaderCell>{scope.kind === "group" ? <TableHeaderCell className="max-sm:hidden">{t("tabs.projects.managingCompany")}</TableHeaderCell> : <TableHeaderCell className="max-sm:hidden">{t("tabs.projects.role")}</TableHeaderCell>}<TableHeaderCell className="max-md:hidden">{t("common.users")}</TableHeaderCell><TableHeaderCell>{t("common.status")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("tabs.projects.threeD")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <LinkRow key={row.id} href={`/admin/projects/${row.id}?from=${org.id}`} data-testid="org-project">
                  <TableCell><Link href={`/admin/projects/${row.id}?from=${org.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell>
                  <TableCell className="max-sm:hidden">{scope.kind === "group" ? <Link href={`/admin/organizations/${row.company.id}?tab=projects`} className="hover:underline">{row.company.name}</Link> : t("tabs.projects.managing")}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.users}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  <TableCell className="max-sm:hidden"><AdminStatusBadge status={row.threeD} /></TableCell>
                </LinkRow>
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
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminOrgs");
  if (params.member) return <MemberPanel context={context} scope={scope} org={org} membershipId={params.member} />;
  const [{ filter, rows: all }, { roles }, projects, companies, people] = await Promise.all([organizationUsers(context, scope, params), organizationRoles(context, scope), organizationProjectOptions(context, scope), companiesOf(context, scope, org), scope.kind === "group" ? groupPeople(context, scope.groupId) : Promise.resolve(null)]);
  // A group's own people have their own card; this list is company staff.
  const rows = scope.kind === "group" ? all.filter((row) => row.membershipId) : all;
  const canManage = org.open && canPlatform(context, "platform.membership.manage");
  const assignable = roleOptions(roles, tr);
  const filtered = Boolean(filter.q || filter.role || filter.project || filter.status || filter.company);
  const add = canManage && companies.length ? <AddOrganizationUser organizationName={org.name} companies={companies} roles={assignable} projects={projects} /> : null;
  const needCompany = scope.kind === "group" && org.open && companies.length === 0;
  const addCompany = needCompany ? <AddCompanyToGroup group={{ value: org.id, label: org.name }} standalone={await attachableCompanies(context)} /> : null;
  const groupCard = people && scope.kind === "group" ? (
    <Card
      title={t("groupUsers.title")}
      description={people.ceo ? t("groupUsers.currentCeo", { name: people.ceo.name }) : t("groupUsers.description", { name: org.name })}
      action={org.open && canManage ? (
        <div className="flex flex-wrap gap-2">
          <AddGroupUser groupId={org.id} groupName={org.name} hasCompany={companies.length > 0} ceoName={people.ceo?.name ?? null} ceoOnly label={people.ceo ? t("groupUsers.changeCeo") : t("groupUsers.assignCeo")} />
          <AddGroupUser groupId={org.id} groupName={org.name} hasCompany={companies.length > 0} ceoName={people.ceo?.name ?? null} label={t("groupUsers.add")} />
        </div>
      ) : null}
    >
      {people.people.length === 0 ? (
        <EmptyState className="m-4" title={people.ceo ? t("groupUsers.emptyTitle") : t("groupUsers.noCeo")} description={needCompany ? t("tabs.users.needCompany") : people.ceo ? t("groupUsers.emptyBody", { name: org.name }) : t("groupUsers.noCeoBody")} />
      ) : (
        <div className="overflow-x-auto">
          <Table stack aria-label={t("groupUsers.title")}>
            <TableHead><TableRow><TableHeaderCell>{t("groupUsers.person")}</TableHeaderCell><TableHeaderCell>{t("groupUsers.groupRole")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("groupUsers.companies")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("groupUsers.projects")}</TableHeaderCell><TableHeaderCell>{t("groupUsers.status")}</TableHeaderCell><TableHeaderCell><span className="sr-only">{t("common.actions")}</span></TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {people.people.map((person) => (
                <TableRow key={person.userId} data-testid="group-person">
                  <TableCell><span className="font-medium text-fg">{person.name}</span><p className="font-mono text-micro text-fg-subtle">{person.email ?? person.username}</p></TableCell>
                  <TableCell>{person.roleKey ? t(`groupUsers.role${person.roleKey}`) : t("groupUsers.seatOnly")}</TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{person.companies}</TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{person.projects}</TableCell>
                  <TableCell><AdminStatusBadge status={person.account !== "ACTIVE" ? person.account : person.seat} /></TableCell>
                  <TableCell className="text-right">{canManage ? <GroupPersonActions groupId={org.id} groupName={org.name} person={{ userId: person.userId, name: person.name, roleKey: person.roleKey, seatActive: person.seat === "ACTIVE" }} ceoName={people.ceo?.name ?? null} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  ) : null;
  const list = (
    <Card title={t("common.users")} description={t("tabs.users.description", { name: org.name })} action={add ?? addCompany}>
      {scope.kind === "group" ? <p className="border-b border-line px-5 py-3 text-table text-fg-muted" data-testid="group-level-hint">{t("tabs.users.groupLevelHint")}</p> : null}
      <form method="get" action={`/admin/organizations/${org.id}`} className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3" aria-label={t("tabs.users.filterLabel")}>
        <input type="hidden" name="tab" value="users" />
        <input name="q" defaultValue={filter.q} placeholder={t("tabs.users.searchPlaceholder")} aria-label={t("tabs.users.searchAria")} className={cn(fieldClass, "min-w-48 flex-1")} />
        <select name="role" defaultValue={filter.role} aria-label={t("common.role")} className={fieldClass}><option value="">{t("tabs.users.anyRole")}</option>{roles.map((row) => <option key={row.key} value={row.key}>{adminRoleName(tr, row.name)}</option>)}</select>
        <select name="project" defaultValue={filter.project} aria-label={t("common.project")} className={fieldClass}><option value="">{t("tabs.users.anyProject")}</option>{projects.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select>
        <select name="status" defaultValue={filter.status} aria-label={t("common.status")} className={fieldClass}><option value="">{t("tabs.users.anyStatus")}</option><option value="ACTIVE">{t("statusLabel.ACTIVE")}</option><option value="INACTIVE">{t("statusLabel.REMOVED")}</option><option value="SUSPENDED">{t("statusLabel.SUSPENDED")}</option><option value="INVITED">{t("statusLabel.INVITED")}</option></select>
        {scope.kind === "group" ? <select name="company" defaultValue={filter.company} aria-label={t("common.company")} className={fieldClass}><option value="">{t("tabs.users.anyCompany")}</option>{companies.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select> : null}
        <button type="submit" className="h-9 rounded-lg border border-line px-3 text-table font-medium text-fg hover:bg-hover">{t("tabs.users.apply")}</button>
        {filtered ? <Link href={tabHref(org, "users")} className="h-9 px-2 text-table leading-9 text-fg-muted hover:text-fg">{t("tabs.users.clear")}</Link> : null}
      </form>
      {rows.length === 0 ? (
        filtered ? <NoResultsState className="m-4" noun={t("tabs.users.noun")} clearHref={tabHref(org, "users")} /> : (
          <div className="m-4 space-y-3 text-center"><EmptyState title={t("tabs.users.emptyTitle")} description={needCompany ? t("tabs.users.needCompany") : t("tabs.users.emptyBody", { kind: scope.kind === "group" ? t("tabs.users.kindGroup") : t("tabs.users.kindCompany") })} />{add ?? addCompany}</div>
        )
      ) : (
        <div className="overflow-x-auto">
          <Table stack aria-label={t("common.users")}>
            <TableHead><TableRow><TableHeaderCell>{t("tabs.users.user")}</TableHeaderCell><TableHeaderCell>{t("common.role")}</TableHeaderCell>{scope.kind === "group" ? <TableHeaderCell className="max-md:hidden">{t("common.company")}</TableHeaderCell> : null}<TableHeaderCell className="max-md:hidden">{t("common.projects")}</TableHeaderCell><TableHeaderCell>{t("common.status")}</TableHeaderCell><TableHeaderCell><span className="sr-only">{t("common.actions")}</span></TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="org-user">
                  <TableCell>
                    {row.membershipId ? <Link href={tabHref(org, "users", { member: row.membershipId })} className="font-medium text-fg hover:underline">{row.name}</Link> : <span className="font-medium text-fg">{row.name}</span>}
                    <p className="font-mono text-micro text-fg-subtle">{row.email ?? row.username}</p>
                  </TableCell>
                  <TableCell>{row.role}</TableCell>
                  {scope.kind === "group" ? <TableCell className="max-md:hidden">{row.company ? <Link href={`/admin/organizations/${row.company.id}?tab=users`} className="hover:underline">{row.company.name}</Link> : t("tabs.users.allCompanies")}</TableCell> : null}
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
  return groupCard ? <div className="space-y-6">{groupCard}{list}</div> : list;
}

/** One user as this organization sees them (§23, §24); the platform account is one explicit link away. */
async function MemberPanel({ context, scope, org, membershipId }: { context: PlatformContext; scope: OrganizationScope; org: Org; membershipId: string }) {
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminOrgs");
  const [member, { roles }, projects] = await Promise.all([organizationMember(context, scope, membershipId), organizationRoles(context, scope), organizationProjectOptions(context, scope)]);
  if (!member) return <EmptyState className="nesto-card p-6" title={t("tabs.member.notPart")} action={{ label: t("tabs.member.backToUsers"), href: tabHref(org, "users") }} />;
  const canManage = org.open && canPlatform(context, "platform.membership.manage");
  return (
    <section className="nesto-card p-5" aria-label={member.user.name} data-testid="org-member">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={tabHref(org, "users")} className="text-table text-fg-muted hover:text-fg">{t("tabs.member.backLink")}</Link>
          <h2 className="mt-1 text-card font-semibold text-fg">{member.user.name}</h2>
          <p className="font-mono text-meta text-fg-subtle">{member.user.email ?? member.user.username}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/users/${member.user.id}?from=${org.id}`} className="text-table font-medium text-accent-strong hover:underline">{t("tabs.member.viewAccount")}</Link>
          {canManage ? <OrganizationMemberActions companyId={member.company.id} companyName={member.company.name} member={{ id: member.id, name: member.user.name, roleKey: member.roleKey, projectIds: member.projects.map((project) => project.id), active: member.status === "ACTIVE" }} roles={roleOptions(roles, tr)} projects={projects} detailHref={tabHref(org, "users", { member: member.id })} accountHref={`/admin/users/${member.user.id}?from=${org.id}`} /> : null}
        </div>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {([
          [t("common.company"), member.company.name],
          [t("common.role"), adminRoleName(tr, member.role)],
          [t("tabs.member.department"), member.department ?? "—"],
          [t("tabs.member.statusHere"), member.status === "INACTIVE" ? t("statusLabel.REMOVED") : statusLabel(t, member.status)],
          [t("tabs.member.account"), statusLabel(t, member.user.status)],
          [t("tabs.member.joined"), member.joinedAt ? formatDate(member.joinedAt) : "—"],
          [t("tabs.member.lastSignIn"), member.user.lastLoginAt ? formatRelativeTime(member.user.lastLoginAt) : t("tabs.member.never")],
        ] as const).map(([label, value]) => <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{value}</dd></div>)}
      </dl>
      <h3 className="mt-5 text-table font-semibold text-fg">{t("common.projects")}</h3>
      {member.projects.length === 0 ? <p className="mt-1 text-table text-fg-muted">{t("tabs.member.noProjects", { company: member.company.name })}</p> : (
        <ul className="mt-1 divide-y divide-line text-table">{member.projects.map((project) => <li key={project.id} className="flex justify-between gap-2 py-1.5"><Link href={`/admin/projects/${project.id}?from=${org.id}`} className="text-fg hover:underline">{project.name}</Link><span className="text-fg-muted">{project.role ?? ""}</span></li>)}</ul>
      )}
      <p className="mt-4 text-meta text-fg-subtle">{t("tabs.member.footer")}</p>
    </section>
  );
}

/**
 * NESTO's role catalogue in this organization (§25-§32): who holds each role
 * here. Roles are assigned, never redefined; a role's detail lists its holders
 * and moves a member into it, within this scope only.
 */
export async function RolesTab({ context, scope, org, params }: { context: PlatformContext; scope: OrganizationScope; org: Org; params: Params }) {
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminOrgs");
  const { roles, groupSeats } = await organizationRoles(context, scope).catch(() => ({ roles: [], groupSeats: 0 }));
  if (roles.length === 0) return <EmptyState className="nesto-card p-6" title={t("tabs.roles.unable")} action={{ label: t("tabs.roles.tryAgain"), href: tabHref(org, "roles") }} />;
  const selected = roles.find((row) => row.key === params.role);
  if (selected) return <RoleDetail context={context} scope={scope} org={org} role={selected} roles={roles} />;
  return (
    <Card title={t("tabs.roles.title")} description={t("tabs.roles.description", { name: org.name })}>
      <ul className="divide-y divide-line">
        {roles.map((row) => (
          <li key={row.key}>
            <Link href={tabHref(org, "roles", { role: row.key })} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-hover" data-testid="org-role">
              <span className="min-w-0"><span className="block text-body text-fg">{adminRoleName(tr, row.name)}{row.groupLevel ? <span className="ml-2 text-meta text-fg-subtle">{t("tabs.roles.groupLevel")}</span> : null}</span><span className="block truncate text-meta text-fg-subtle max-sm:hidden">{row.description}</span></span>
              <span className="shrink-0 text-table tabular-nums text-fg-muted">{t("tabs.roles.users", { count: row.users })}</span>
            </Link>
          </li>
        ))}
      </ul>
      {scope.kind === "group" ? (() => { const [before, after] = t("tabs.roles.seatsNote", { seats: t("tabs.roles.seats", { count: groupSeats }), link: "\u0001" }).split("\u0001"); return <p className="border-t border-line px-5 py-3 text-meta text-fg-subtle">{before}<Link href={`/admin/organizations/${org.id}/departments`} className="text-accent-strong hover:underline">{t("tabs.roles.departmentsLink")}</Link>{after}</p>; })() : null}
    </Card>
  );
}

async function RoleDetail({ context, scope, org, role, roles }: { context: PlatformContext; scope: OrganizationScope; org: Org; role: Awaited<ReturnType<typeof organizationRoles>>["roles"][number]; roles: Awaited<ReturnType<typeof organizationRoles>>["roles"] }) {
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminOrgs");
  const [{ rows }, projects, companies] = await Promise.all([organizationUsers(context, scope, { role: role.key, status: "ACTIVE" }), organizationProjectOptions(context, scope), companiesOf(context, scope, org)]);
  const canManage = org.open && canPlatform(context, "platform.membership.manage") && !role.groupLevel;
  const assignable = roleOptions(roles, tr);
  return (
    <Card
      title={adminRoleName(tr, role.name)}
      description={t("tabs.roles.detailDescription", { count: rows.length, name: org.name, description: role.description })}
      action={canManage && companies.length ? <AddOrganizationUser organizationName={org.name} companies={companies} roles={assignable.filter((row) => row.value === role.key)} projects={projects} label={t("tabs.roles.assignUser")} /> : null}
    >
      <div className="border-b border-line px-5 py-2"><Link href={tabHref(org, "roles")} className="text-table text-fg-muted hover:text-fg">{t("tabs.roles.back")}</Link></div>
      {role.groupLevel ? <p className="border-b border-line px-5 py-3 text-table text-fg-muted">{t("tabs.roles.groupLevelNote")}</p> : null}
      {rows.length === 0 ? <EmptyState className="m-4" title={t("tabs.roles.nobody", { role: adminRoleName(tr, role.name) })} /> : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-2.5" data-testid="org-role-holder">
              <span><Link href={tabHref(org, "users", { member: row.membershipId ?? undefined })} className="text-body text-fg hover:underline">{row.name}</Link>{row.company && scope.kind === "group" ? <span className="block text-meta text-fg-subtle">{row.company.name}</span> : null}</span>
              {canManage && row.membershipId && row.company && row.roleKey ? <OrganizationMemberActions companyId={row.company.id} companyName={row.company.name} member={{ id: row.membershipId, name: row.name, roleKey: row.roleKey, projectIds: row.projects.map((project) => project.id), active: true }} roles={assignable} projects={projects} detailHref={tabHref(org, "users", { member: row.membershipId })} accountHref={`/admin/users/${row.userId}?from=${org.id}`} /> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-5 py-3 text-meta text-fg-subtle">{t("tabs.roles.footer")}</p>
    </Card>
  );
}

/**
 * The company's own entitlements, edited here with the same engine as the
 * Modules area (§38-§43); a group shows each company's, one link each, since
 * modules are granted company by company.
 */
export async function ModulesTab({ context, scope, org }: { context: PlatformContext; scope: OrganizationScope; org: Org }) {
  const t = await getTranslations("adminOrgs");
  if (scope.kind === "group") {
    const [{ companies, modules }, rows] = await Promise.all([organizationModules(context, scope), organizationCompanies(context, scope.groupId)]);
    return (
      <div className="space-y-5">
        <Card title={t("common.modules")} description={t("tabs.modules.groupDescription", { on: modules.filter((row) => row.enabledIn > 0).length, total: modules.length, companies })}>
          <ul className="divide-y divide-line">
            {modules.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 px-5 py-2.5"><span className="text-body text-fg">{row.name}</span><span className="shrink-0 text-table tabular-nums text-fg-muted">{t("tabs.modules.enabledIn", { enabled: row.enabledIn, companies })}</span></li>
            ))}
          </ul>
        </Card>
        {rows.length ? (
          <Card title={t("tabs.modules.editCompany")}>
            <ul className="divide-y divide-line">{rows.map((row) => <li key={row.id}><Link href={`/admin/organizations/${row.id}?tab=modules`} className="flex items-center justify-between px-5 py-2.5 text-table hover:bg-hover"><span className="text-fg">{row.name}</span><span className="text-fg-muted">{t("tabs.modules.modulesOn", { count: row.modules })}</span></Link></li>)}</ul>
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
      <section className="space-y-3" aria-label={t("common.modules")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-table text-fg-muted">{t("tabs.modules.intro", { name: org.name })}</p>
          <Link href={`/admin/modules/${scope.companyId}?tab=history`} className="text-table font-medium text-accent-strong hover:underline">{t("tabs.modules.openHistory")}</Link>
        </div>
        {data.company.status !== "ACTIVE" ? <p className="text-meta text-fg-subtle">{t("tabs.modules.inactiveNote", { status: statusWord(t, data.company.status) })}</p> : null}
        <EntitlementEditor companyId={scope.companyId} version={data.version} plan={data.plan} plans={options} modules={data.modules} canManage={canManage} />
      </section>
      <Card title={t("tabs.modules.projectControlled")} description={t("tabs.modules.projectControlledDescription")}>
        {data.projects.length === 0 ? <EmptyState className="m-4" title={t("tabs.modules.noProjects")} /> : (
          <div className="overflow-x-auto">
            <Table stack aria-label={t("tabs.modules.projectEntitlements")}>
              <TableHead><TableRow><TableHeaderCell>{t("common.project")}</TableHeaderCell><TableHeaderCell>{t("tabs.modules.viewer3d")}</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
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
  const t = await getTranslations("adminOrgs");
  const [usage, limits] = await Promise.all([
    organizationUsage(context, scope),
    scope.kind === "company" && canPlatform(context, "platform.module.view") ? getCompanyEntitlements(context, scope.companyId).then((data) => data.limits) : Promise.resolve(null),
  ]);
  const of = (value: number, limit: number | null | undefined) => (limit === null || limit === undefined ? String(value) : `${value} / ${limit}`);
  const items: [string, string | number][] = [
    ...(scope.kind === "group" ? [[t("tabs.usage.companies"), usage.companies] as [string, number]] : []),
    [t("common.users"), of(usage.users, limits?.maxActiveUsers)], [t("common.projects"), of(usage.projects, limits?.maxProjects)], [t("tabs.usage.modulesEnabled"), usage.modules],
    [t("tabs.usage.storage"), t("tabs.usage.storageValue", { size: `${bytes(usage.storageBytes)}${limits?.maxStorageBytes ? ` / ${bytes(limits.maxStorageBytes)}` : ""}`, files: usage.files })], [t("tabs.usage.experiences"), usage.experiences],
  ];
  return (
    <Card title={t("tabs.usage.title")} description={scope.kind === "group" ? t("tabs.usage.groupDescription") : undefined}>
      <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-card font-semibold tabular-nums text-fg">{value}</dd></div>
        ))}
      </dl>
    </Card>
  );
}
