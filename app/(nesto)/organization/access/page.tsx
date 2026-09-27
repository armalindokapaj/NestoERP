import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { GrantAccessButton, RevokeGrantButton } from "@/components/organization/access-grants";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { selectClass } from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import type { AccessLevel, DataScope } from "@/config/access";
import { MODULE_KEYS, modules as moduleRegistry } from "@/config/modules";
import { defaultAccessFor } from "@/config/role-defaults";
import { MEMBERSHIP_ROLE_KEYS, isMembershipRoleKey, positionLabels, roleLabel, roles, type RoleKey } from "@/config/roles";
import { can, canAny } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { moduleName, organizationLabel } from "@/lib/i18n/modules/organization/labels";
import type { Translate } from "@/lib/i18n/translator";
import type { UserContext } from "@/lib/context/types";
import { accessCheckOptions, accessCheckQuerySchema, diagnoseAccess, type AccessDiagnosisDTO } from "@/lib/modules/organization/access-diagnostics.service";
import { grantListQuerySchema, grantOptions, listAccessGrants, type GrantStatus } from "@/lib/modules/organization/access-grant.service";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("organization"))("access.metaTitle") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

const LEVEL_LABELS: Record<AccessLevel, string> = { NONE: "None", VIEW: "View", CONTRIBUTE: "Contribute", APPROVE: "Approve", MANAGE: "Manage" };
const SCOPE_LABELS: Record<DataScope, string> = { SELF: "own", ASSIGNED: "assigned", PROJECT: "their projects", DEPARTMENT: "their department", COMPANY: "company-wide", GROUP: "group-wide", SYSTEM: "system" };
const STATUS_TONES: Record<GrantStatus, "success" | "info" | "default"> = { LIVE: "success", SCHEDULED: "info", EXPIRED: "default", REVOKED: "default" };
const SOURCE_LABELS: Record<string, string> = { ROLE: "Role", POSITION: "Position", GRANT: "Delegated", DISABLED: "Module off", NONE: "—", BLOCKED: "Blocked" };

type T = Translate<"organization">;
type Modules = Translate<"modules">;

const level = (t: T, value: AccessLevel) => organizationLabel(t, "level", value, LEVEL_LABELS[value]);

function access(t: T, cell: { accessLevel: AccessLevel; scope: DataScope }) {
  return cell.accessLevel === "NONE" ? "—" : `${level(t, cell.accessLevel)}, ${organizationLabel(t, "scope", cell.scope, SCOPE_LABELS[cell.scope])}`;
}

function grantStatus(t: T, status: GrantStatus) {
  return organizationLabel(t, "grantStatus", status, status === "LIVE" ? "In force" : status.charAt(0) + status.slice(1).toLowerCase());
}

/**
 * Access & roles (E-06 §18, §73, §127): what each role opens at each position,
 * who has been handed more than their role gives them, and — for those who
 * keep access — why a particular person can or cannot do something in a
 * particular company. A department head sees the delegated access of their
 * own function only.
 */
export default async function AccessPage({ searchParams }: Props) {
  const context = await requireModule("organization");
  const keeps = can(context, "organization.access.view");
  const delegates = canAny(context, ["organization.access.grant", "department.team.access.delegate"]);
  if (!keeps && !delegates) redirect("/access-denied");

  const params = await searchParams;
  const t = await getTranslations("organization");
  const requested = one(params.view);
  const view = keeps && (requested === "roles" || requested === "check") ? requested : "grants";
  const tab = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "organization")}
      activeSection="access"
      title={keeps ? t("access.title") : t("access.delegatedTitle")}
      description={
        keeps
          ? t("access.description")
          : t("access.delegatedDescription")
      }
    >
      <div className="space-y-4">
        {keeps ? (
          <nav aria-label={t("access.views")} className="flex flex-wrap gap-2">
            <Link href="/organization/access" className={tab(view === "grants")}>
              {t("access.delegated")}
            </Link>
            <Link href="/organization/access?view=roles" className={tab(view === "roles")}>
              {t("access.roles")}
            </Link>
            <Link href="/organization/access?view=check" className={tab(view === "check")}>
              {t("access.check")}
            </Link>
          </nav>
        ) : null}

        {view === "grants" ? <GrantsView context={context} status={one(params.status)} /> : null}
        {view === "roles" ? <RolesView role={one(params.role)} t={t} /> : null}
        {view === "check" ? <CheckView context={context} params={params} /> : null}
      </div>
    </ModulePage>
  );
}

async function GrantsView({ context, status }: { context: UserContext; status: string | undefined }) {
  const query = grantListQuerySchema.parse({ status: status === "all" ? "all" : "live" });
  const [grants, options, t, modules] = await Promise.all([listAccessGrants(context, query), grantOptions(context), getTranslations("organization"), getTranslations("modules")]);
  const chip = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");
  return (
    <section className="space-y-3" aria-label={t("access.delegated")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t("access.grantStatus")} className="flex flex-wrap gap-2">
          <Link href="/organization/access" className={chip(query.status === "live")}>
            {t("access.inForce")}
          </Link>
          <Link href="/organization/access?status=all" className={chip(query.status === "all")}>
            {t("access.allHistory")}
          </Link>
        </nav>
        {options ? <GrantAccessButton options={options} /> : null}
      </div>
      {grants.length === 0 ? (
        <EmptyState title={t("access.nothingDelegated")} description={t("access.nothingDelegatedDescription")} />
      ) : (
        <>
        {/*
          * Phones get one card per grant with every column's value and Revoke
          * on the card, not ~900px to the right (AUD-04 §5, D-07-19, MW-05).
          */}
        <ul className="space-y-3 md:hidden" aria-label={t("access.delegated")}>
          {grants.map((grant) => (
            <li key={grant.id} className="nesto-card space-y-1.5 px-4 py-3" data-testid="grant-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                  <PersonLink userId={grant.holder.userId} name={grant.holder.name} />
                </span>
                <Badge tone={STATUS_TONES[grant.status]}>{grantStatus(t, grant.status)}</Badge>
              </div>
              <p className="text-table text-fg">
                {moduleName(modules, grant.module.key, grant.module.label)} · {level(t, grant.accessLevel)} · {grant.scope.type === "GROUP" ? t("access.everyCompany") : (grant.scope.company?.name ?? "—")}
              </p>
              <p className="text-meta text-fg-muted [overflow-wrap:anywhere]">
                {t("access.delegatedBy")} <PersonLink userId={grant.grantedBy.userId} name={grant.grantedBy.name} />
                {grant.reason ? ` — ${grant.reason}` : ""}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-meta text-fg-muted">{grant.revokedAt ? t("access.revokedOn", { date: formatDate(grant.revokedAt) }) : grant.expiresAt ? t("access.untilDate", { date: formatDate(grant.expiresAt) }) : t("access.untilRevoked")}</p>
                {grant.canRevoke ? <RevokeGrantButton grantId={grant.id} holder={grant.holder.name} module={moduleName(modules, grant.module.key, grant.module.label)} /> : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="nesto-card hidden p-0 md:block">
          <Table flush label={t("access.delegated")} aria-label={t("access.delegated")}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("common.person")}</TableHeaderCell>
                <TableHeaderCell>{t("common.module")}</TableHeaderCell>
                <TableHeaderCell>{t("access.access")}</TableHeaderCell>
                <TableHeaderCell>{t("common.where")}</TableHeaderCell>
                <TableHeaderCell>{t("common.status")}</TableHeaderCell>
                <TableHeaderCell>{t("access.delegatedBy")}</TableHeaderCell>
                <TableHeaderCell>{t("common.until")}</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">{t("access.actions")}</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id} data-testid="grant-row">
                  <TableCell className="font-medium">
                    <PersonLink userId={grant.holder.userId} name={grant.holder.name} />
                  </TableCell>
                  <TableCell>{moduleName(modules, grant.module.key, grant.module.label)}</TableCell>
                  <TableCell>{level(t, grant.accessLevel)}</TableCell>
                  <TableCell>{grant.scope.type === "GROUP" ? t("access.everyCompany") : (grant.scope.company?.name ?? "—")}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONES[grant.status]}>{grantStatus(t, grant.status)}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="block">
                      <PersonLink userId={grant.grantedBy.userId} name={grant.grantedBy.name} />
                    </span>
                    {grant.reason ? <span className="block text-meta text-fg-subtle">{grant.reason}</span> : null}
                  </TableCell>
                  <TableCell>{grant.revokedAt ? t("access.revokedOn", { date: formatDate(grant.revokedAt) }) : grant.expiresAt ? formatDate(grant.expiresAt) : t("access.untilRevoked")}</TableCell>
                  <TableCell className="text-right">{grant.canRevoke ? <RevokeGrantButton grantId={grant.id} holder={grant.holder.name} module={moduleName(modules, grant.module.key, grant.module.label)} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </section>
  );
}

async function RolesView({ role: requested, t }: { role: string | undefined; t: T }) {
  const [roleNames, modules] = await Promise.all([getTranslations("roles"), getTranslations("modules")]);
  const roleName = (key: RoleKey) => {
    const text = roleNames(`${key}.label`);
    return text === `${key}.label` ? roleLabel(key) : text;
  };
  const roleDescription = (key: RoleKey) => {
    const text = roleNames(`${key}.description`);
    return text === `${key}.description` ? roles[key].description : text;
  };
  const role: RoleKey = requested && isMembershipRoleKey(requested) ? requested : "OWNER";
  const chip = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");
  const rows = MODULE_KEYS.filter((key) => key !== "dashboard")
    .map((key) => ({ key, label: moduleName(modules, key, moduleRegistry[key].label), member: defaultAccessFor(role, key, "MEMBER"), manager: defaultAccessFor(role, key, "COMPANY_MANAGER"), head: defaultAccessFor(role, key, "GROUP_HEAD") }))
    .filter((row) => row.member.accessLevel !== "NONE" || row.manager.accessLevel !== "NONE" || row.head.accessLevel !== "NONE");
  return (
    <section className="space-y-3" aria-label={t("access.roles")}>
      <nav aria-label={t("access.role")} className="flex flex-wrap gap-2">
        {MEMBERSHIP_ROLE_KEYS.map((key) => (
          <Link key={key} href={`/organization/access?view=roles&role=${key}`} className={chip(key === role)}>
            {roleName(key)}
          </Link>
        ))}
      </nav>
      <div className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{roleName(role)}</h2>
        <p className="mt-1 text-table text-fg-muted">{roleDescription(role)}</p>
        <p className="mt-2 text-meta text-fg-subtle">
          {t("access.positionNote", { role: roleName(role) })}
          {roles[role].readOnly ? t("access.readOnly") : ""}
        </p>
      </div>
      <div className="nesto-card p-0">
        <Table flush aria-label={t("access.byPosition", { role: roleName(role) })}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t("common.module")}</TableHeaderCell>
              <TableHeaderCell>{organizationLabel(t, "positionLevel", "MEMBER", positionLabels.MEMBER)}</TableHeaderCell>
              <TableHeaderCell>{organizationLabel(t, "positionLevel", "COMPANY_MANAGER", positionLabels.COMPANY_MANAGER)}</TableHeaderCell>
              <TableHeaderCell>{organizationLabel(t, "positionLevel", "GROUP_HEAD", positionLabels.GROUP_HEAD)}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell>{access(t, row.member)}</TableCell>
                <TableCell className={cn(access(t, row.manager) !== access(t, row.member) && "font-medium text-accent-strong")}>{access(t, row.manager)}</TableCell>
                <TableCell className={cn(access(t, row.head) !== access(t, row.manager) && "font-medium text-accent-strong")}>{access(t, row.head)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

async function CheckView({ context, params }: { context: UserContext; params: Record<string, string | string[] | undefined> }) {
  const [options, t, modules] = await Promise.all([accessCheckOptions(context), getTranslations("organization"), getTranslations("modules")]);
  const parsed = accessCheckQuerySchema.safeParse({ userId: one(params.userId), targetCompanyId: one(params.targetCompanyId), permission: one(params.permission) });
  let diagnosis: AccessDiagnosisDTO | null = null;
  let notFound = false;
  if (parsed.success) {
    try {
      diagnosis = await diagnoseAccess(context, parsed.data);
    } catch {
      notFound = true;
    }
  }
  return (
    <section className="space-y-4" aria-label={t("access.check")}>
      <form method="get" action="/organization/access" className="nesto-card grid gap-4 p-5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <input type="hidden" name="view" value="check" />
        <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
          {t("common.person")}
          <select name="userId" defaultValue={one(params.userId) ?? ""} className={selectClass} required>
            <option value="">{t("access.choosePerson")}</option>
            {options.people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name} ({person.username})
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
          {t("common.company")}
          <select name="targetCompanyId" defaultValue={one(params.targetCompanyId) ?? context.companyId} className={selectClass} required>
            {options.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
          {t("access.permission")}
          <Input name="permission" defaultValue={one(params.permission) ?? ""} placeholder="finance.payment.approve" />
        </label>
        <Button type="submit">{t("access.checkButton")}</Button>
      </form>

      {notFound ? <EmptyState title={t("access.nothingToCheck")} description={t("access.notInGroup")} /> : null}
      {diagnosis ? <Diagnosis diagnosis={diagnosis} t={t} modules={modules} /> : null}
    </section>
  );
}

function Diagnosis({ diagnosis, t, modules }: { diagnosis: AccessDiagnosisDTO; t: T; modules: Modules }) {
  const reasons: Record<string, string> = {
    HELD: "Held.",
    BLOCKED: "Not held: nothing works until the blockers above are cleared.",
    MODULE_DISABLED: "Not held: the company has switched this module off.",
    NOT_IN_ACCESS: "Not held: neither the role, the position nor a delegated grant gives it here.",
    UNKNOWN_PERMISSION: "NESTO has no permission by that name.",
  };
  const opened = diagnosis.modules.filter((row) => row.effective.accessLevel !== "NONE" || row.source === "DISABLED" || row.source === "BLOCKED" || row.position.accessLevel !== "NONE");
  return (
    <div className="space-y-4" data-testid="access-diagnosis">
      <div className="nesto-card space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-card font-semibold text-fg">
            {(() => {
              // The person's link sits where the sentence puts it.
              const [before, after] = t("access.inCompany", { company: diagnosis.company.name }).split("{person}");
              return (
                <>
                  {before}
                  <PersonLink userId={diagnosis.person.userId} name={diagnosis.person.name} />
                  {after}
                </>
              );
            })()}
          </h2>
          <span className="text-meta text-fg-subtle">
            {diagnosis.membership ? `${diagnosis.membership.role.label} · ${diagnosis.position.label}` : t("access.noMembership")}
          </span>
        </div>
        {diagnosis.blockers.length > 0 ? (
          <ul className="space-y-1" aria-label={t("access.blockers")}>
            {diagnosis.blockers.map((blocker) => (
              <li key={blocker.code} className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
                {blocker.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-table text-fg-muted">{t("access.nothingBlocks")}</p>
        )}
        {diagnosis.position.heldThrough.length > 0 ? (
          <p className="text-table text-fg-muted">
            {t("access.heldThrough")}{" "}
            {diagnosis.position.heldThrough.map((row) => `${row.level}, ${row.department} (${row.where})`).join("; ")}.
          </p>
        ) : null}
        {diagnosis.grants.length > 0 ? (
          <p className="text-table text-fg-muted">
            {t("access.delegatedHere", { grants: diagnosis.grants.map((grant) => `${moduleName(modules, grant.moduleKey, grant.moduleLabel)} ${level(t, grant.accessLevel)} (${grant.scope === "GROUP" ? t("access.group") : t("access.company")})`).join(", ") })}
          </p>
        ) : null}
        {diagnosis.permission ? (
          <p className={cn("rounded-md border px-3 py-2 text-table", diagnosis.permission.held ? "border-success/30 bg-success-soft text-success-strong" : "border-line bg-surface-2 text-fg")} data-testid="permission-answer">
            <span className="font-mono">{diagnosis.permission.key}</span>: {organizationLabel(t, "reason", diagnosis.permission.reason, reasons[diagnosis.permission.reason])}
          </p>
        ) : null}
      </div>

      <div className="nesto-card p-0">
        <Table flush aria-label={t("access.moduleAccess")}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t("common.module")}</TableHeaderCell>
              <TableHeaderCell>{t("access.byRole")}</TableHeaderCell>
              <TableHeaderCell>{t("access.withPosition")}</TableHeaderCell>
              <TableHeaderCell>{t("access.inEffect")}</TableHeaderCell>
              <TableHeaderCell>{t("access.becauseOf")}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {opened.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{moduleName(modules, row.key, row.label)}</TableCell>
                <TableCell>{access(t, row.role)}</TableCell>
                <TableCell>{access(t, row.position)}</TableCell>
                <TableCell className="font-medium">{access(t, row.effective)}</TableCell>
                <TableCell>{organizationLabel(t, "source", row.source, SOURCE_LABELS[row.source])}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
