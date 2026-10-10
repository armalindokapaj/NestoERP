import Link from "@/components/navigation/nav-link";
import { adminRoleName } from "@/components/platform/admin-roles";
import { AddCompanyUserButton, CompanyUsersTable } from "@/components/platform/company-users";
import type { CompanyUsersApi } from "@/components/platform/company-user-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { getTranslations } from "@/lib/i18n/server";
import type { GroupActor } from "@/lib/modules/platform/group-actor";
import { companyUserOptions, listCompanyUsers } from "@/lib/modules/platform/company-users.service";
import { prisma } from "@/lib/database/prisma";
import { FormSelect } from "@/components/ui/form-select";

const fieldClass = "h-9 rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const FILTER_KEYS = ["q", "role", "departmentId", "status", "source", "projectId", "sort"] as const;

/**
 * A company's Users, wherever the company is administered from (PRD #13 §4,
 * §7): the Platform Admin's company page and the group's own company page both
 * render this, with their own command endpoint and actor. It never leaves the
 * company: opening a person is a drawer on this page, and the global account is
 * one explicit link away for those who may use it.
 */
export async function CompanyUsersPanel({ actor, companyId, open, api, platform, formAction, hidden = {}, params, leadershipHref }: {
  actor: GroupActor; companyId: string; open: boolean; api: CompanyUsersApi; platform: boolean;
  formAction: string; hidden?: Record<string, string>; params: Record<string, string | undefined>; leadershipHref?: string;
}) {
  const t = await getTranslations("adminOrgs");
  const tr = await getTranslations("roles");
  const query = Object.fromEntries(FILTER_KEYS.map((key) => [key, params[key] ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>;
  const [list, options, group] = await Promise.all([
    listCompanyUsers(actor, { companyId, ...query }),
    companyUserOptions(actor, { companyId }),
    prisma.company.findUnique({ where: { id: companyId }, select: { parentGroup: { select: { name: true, kind: true } } } }),
  ]);
  const groupName = group?.parentGroup.kind === "GROUP" ? group.parentGroup.name : null;
  const filtered = Boolean(query.q || query.role || query.departmentId || query.status || query.source || query.projectId);
  const canManage = open && list.can.manage;
  const clearHref = `${formAction}?${new URLSearchParams(hidden)}`;
  const add = canManage ? <AddCompanyUserButton companyId={companyId} companyName={list.company.name} groupName={groupName} api={api} options={options} /> : null;
  const persistQuery = Object.fromEntries(Object.entries(query).filter(([, value]) => value));

  return (
    <section className="nesto-card overflow-hidden" aria-label={t("companyUsers.title")} data-testid="company-users-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-card font-semibold text-fg">{t("companyUsers.title")} <span className="font-normal text-fg-muted" data-testid="company-users-count">{list.total}</span></h2>
          <p className="text-table text-fg-muted">{t("companyUsers.description", { name: list.company.name })}</p>
        </div>
        {add}
      </div>
      <form method="get" action={formAction} className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3" aria-label={t("companyUsers.filterLabel")}>
        {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <input name="q" defaultValue={query.q} placeholder={t("companyUsers.searchPlaceholder")} aria-label={t("companyUsers.searchAria")} className={`${fieldClass} min-w-48 flex-1`} />
        <FormSelect name="role" defaultValue={query.role} aria-label={t("companyUsers.role")} className={fieldClass}><option value="">{t("companyUsers.anyRole")}</option>{options.roles.map((row) => <option key={row.key} value={row.key}>{adminRoleName(tr, row.name)}</option>)}</FormSelect>
        <FormSelect name="departmentId" defaultValue={query.departmentId} aria-label={t("companyUsers.department")} className={fieldClass}><option value="">{t("companyUsers.anyDepartment")}</option>{options.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</FormSelect>
        <FormSelect name="status" defaultValue={query.status} aria-label={t("companyUsers.status")} className={fieldClass}><option value="">{t("companyUsers.anyStatus")}</option><option value="ACTIVE">{t("statusLabel.ACTIVE")}</option><option value="INVITED">{t("companyUsers.pending")}</option><option value="SUSPENDED">{t("statusLabel.SUSPENDED")}</option></FormSelect>
        <FormSelect name="source" defaultValue={query.source} aria-label={t("companyUsers.access")} className={fieldClass}><option value="">{t("companyUsers.anySource")}</option><option value="DIRECT">{t("companyUsers.sourceDirect")}</option>{groupName ? <option value="GROUP">{t("companyUsers.filterSourceGroup")}</option> : null}{groupName ? <option value="BOTH">{t("companyUsers.sourceBoth")}</option> : null}</FormSelect>
        <FormSelect name="projectId" defaultValue={query.projectId} aria-label={t("companyUsers.projects")} className={fieldClass}><option value="">{t("companyUsers.anyProject")}</option>{options.projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</FormSelect>
        <FormSelect name="sort" defaultValue={query.sort || "name"} aria-label={t("companyUsers.sortAria")} className={fieldClass}><option value="name">{t("companyUsers.sortName")}</option><option value="role">{t("companyUsers.sortRole")}</option><option value="department">{t("companyUsers.sortDepartment")}</option><option value="recent">{t("companyUsers.sortRecent")}</option></FormSelect>
        <button type="submit" className="h-9 rounded-lg border border-line px-3 text-table font-medium text-fg hover:bg-hover">{t("companyUsers.apply")}</button>
        {filtered ? <Link href={clearHref} className="h-9 px-2 text-table leading-9 text-fg-muted hover:text-fg">{t("companyUsers.clear")}</Link> : null}
      </form>
      {list.rows.length === 0 ? (
        filtered ? (
          <div className="m-4 space-y-3 text-center"><p className="text-table text-fg-muted" role="status">{t("companyUsers.noMatch")}</p><Link href={clearHref} className="text-table text-accent-strong hover:underline">{t("companyUsers.clear")}</Link></div>
        ) : (
          <div className="m-4 space-y-3 text-center"><EmptyState title={t("companyUsers.emptyTitle")} description={t("companyUsers.emptyBody", { name: list.company.name })} />{add}</div>
        )
      ) : (
        <CompanyUsersTable
          companyId={companyId} companyName={list.company.name} groupName={groupName} api={api}
          initial={{ rows: list.rows, next: list.nextCursor }} total={list.total} query={persistQuery}
          options={options} canManage={canManage} platform={platform} leadershipHref={leadershipHref}
        />
      )}
    </section>
  );
}
