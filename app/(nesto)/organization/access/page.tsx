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
import type { UserContext } from "@/lib/context/types";
import { accessCheckOptions, accessCheckQuerySchema, diagnoseAccess, type AccessDiagnosisDTO } from "@/lib/modules/organization/access-diagnostics.service";
import { grantListQuerySchema, grantOptions, listAccessGrants, type GrantStatus } from "@/lib/modules/organization/access-grant.service";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Access & roles" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

const LEVEL_LABELS: Record<AccessLevel, string> = { NONE: "None", VIEW: "View", CONTRIBUTE: "Contribute", APPROVE: "Approve", MANAGE: "Manage" };
const SCOPE_LABELS: Record<DataScope, string> = { SELF: "own", ASSIGNED: "assigned", PROJECT: "their projects", DEPARTMENT: "their department", COMPANY: "company-wide", GROUP: "group-wide", SYSTEM: "system" };
const STATUS_TONES: Record<GrantStatus, "success" | "info" | "default"> = { LIVE: "success", SCHEDULED: "info", EXPIRED: "default", REVOKED: "default" };
const SOURCE_LABELS: Record<string, string> = { ROLE: "Role", POSITION: "Position", GRANT: "Delegated", DISABLED: "Module off", NONE: "—", BLOCKED: "Blocked" };

function access(cell: { accessLevel: AccessLevel; scope: DataScope }) {
  return cell.accessLevel === "NONE" ? "—" : `${LEVEL_LABELS[cell.accessLevel]}, ${SCOPE_LABELS[cell.scope]}`;
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
  const requested = one(params.view);
  const view = keeps && (requested === "roles" || requested === "check") ? requested : "grants";
  const tab = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "organization")}
      activeSection="access"
      title={keeps ? "Access & roles" : "Delegated access"}
      description={
        keeps
          ? "What each role opens, what has been delegated on top of it, and why somebody can or cannot do something."
          : "Access you have delegated to your department's people, on top of what their roles give them."
      }
    >
      <div className="space-y-4">
        {keeps ? (
          <nav aria-label="Access views" className="flex flex-wrap gap-2">
            <Link href="/organization/access" className={tab(view === "grants")}>
              Delegated access
            </Link>
            <Link href="/organization/access?view=roles" className={tab(view === "roles")}>
              Roles
            </Link>
            <Link href="/organization/access?view=check" className={tab(view === "check")}>
              Check access
            </Link>
          </nav>
        ) : null}

        {view === "grants" ? <GrantsView context={context} status={one(params.status)} /> : null}
        {view === "roles" ? <RolesView role={one(params.role)} /> : null}
        {view === "check" ? <CheckView context={context} params={params} /> : null}
      </div>
    </ModulePage>
  );
}

async function GrantsView({ context, status }: { context: UserContext; status: string | undefined }) {
  const query = grantListQuerySchema.parse({ status: status === "all" ? "all" : "live" });
  const [grants, options] = await Promise.all([listAccessGrants(context, query), grantOptions(context)]);
  const chip = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");
  return (
    <section className="space-y-3" aria-label="Delegated access">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Grant status" className="flex flex-wrap gap-2">
          <Link href="/organization/access" className={chip(query.status === "live")}>
            In force
          </Link>
          <Link href="/organization/access?status=all" className={chip(query.status === "all")}>
            All, with history
          </Link>
        </nav>
        {options ? <GrantAccessButton options={options} /> : null}
      </div>
      {grants.length === 0 ? (
        <EmptyState title="Nothing delegated" description="Everybody works with what their role and position give them." />
      ) : (
        <>
        {/*
          * Phones get one card per grant with every column's value and Revoke
          * on the card, not ~900px to the right (AUD-04 §5, D-07-19, MW-05).
          */}
        <ul className="space-y-3 md:hidden" aria-label="Delegated access">
          {grants.map((grant) => (
            <li key={grant.id} className="nesto-card space-y-1.5 px-4 py-3" data-testid="grant-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                  <PersonLink userId={grant.holder.userId} name={grant.holder.name} />
                </span>
                <Badge tone={STATUS_TONES[grant.status]}>{grant.status === "LIVE" ? "In force" : grant.status.charAt(0) + grant.status.slice(1).toLowerCase()}</Badge>
              </div>
              <p className="text-table text-fg">
                {grant.module.label} · {LEVEL_LABELS[grant.accessLevel]} · {grant.scope.type === "GROUP" ? "Every company" : (grant.scope.company?.name ?? "—")}
              </p>
              <p className="text-meta text-fg-muted [overflow-wrap:anywhere]">
                Delegated by <PersonLink userId={grant.grantedBy.userId} name={grant.grantedBy.name} />
                {grant.reason ? ` — ${grant.reason}` : ""}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-meta text-fg-muted">{grant.revokedAt ? `Revoked ${formatDate(grant.revokedAt)}` : grant.expiresAt ? `Until ${formatDate(grant.expiresAt)}` : "Until revoked"}</p>
                {grant.canRevoke ? <RevokeGrantButton grantId={grant.id} holder={grant.holder.name} module={grant.module.label} /> : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="nesto-card hidden p-0 md:block">
          <Table flush label="Delegated access" aria-label="Delegated access">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Person</TableHeaderCell>
                <TableHeaderCell>Module</TableHeaderCell>
                <TableHeaderCell>Access</TableHeaderCell>
                <TableHeaderCell>Where</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Delegated by</TableHeaderCell>
                <TableHeaderCell>Until</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id} data-testid="grant-row">
                  <TableCell className="font-medium">
                    <PersonLink userId={grant.holder.userId} name={grant.holder.name} />
                  </TableCell>
                  <TableCell>{grant.module.label}</TableCell>
                  <TableCell>{LEVEL_LABELS[grant.accessLevel]}</TableCell>
                  <TableCell>{grant.scope.type === "GROUP" ? "Every company" : (grant.scope.company?.name ?? "—")}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONES[grant.status]}>{grant.status === "LIVE" ? "In force" : grant.status.charAt(0) + grant.status.slice(1).toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="block">
                      <PersonLink userId={grant.grantedBy.userId} name={grant.grantedBy.name} />
                    </span>
                    {grant.reason ? <span className="block text-meta text-fg-subtle">{grant.reason}</span> : null}
                  </TableCell>
                  <TableCell>{grant.revokedAt ? `Revoked ${formatDate(grant.revokedAt)}` : grant.expiresAt ? formatDate(grant.expiresAt) : "Until revoked"}</TableCell>
                  <TableCell className="text-right">{grant.canRevoke ? <RevokeGrantButton grantId={grant.id} holder={grant.holder.name} module={grant.module.label} /> : null}</TableCell>
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

function RolesView({ role: requested }: { role: string | undefined }) {
  const role: RoleKey = requested && isMembershipRoleKey(requested) ? requested : "OWNER";
  const chip = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");
  const rows = MODULE_KEYS.filter((key) => key !== "dashboard")
    .map((key) => ({ key, label: moduleRegistry[key].label, member: defaultAccessFor(role, key, "MEMBER"), manager: defaultAccessFor(role, key, "COMPANY_MANAGER"), head: defaultAccessFor(role, key, "GROUP_HEAD") }))
    .filter((row) => row.member.accessLevel !== "NONE" || row.manager.accessLevel !== "NONE" || row.head.accessLevel !== "NONE");
  return (
    <section className="space-y-3" aria-label="Roles">
      <nav aria-label="Role" className="flex flex-wrap gap-2">
        {MEMBERSHIP_ROLE_KEYS.map((key) => (
          <Link key={key} href={`/organization/access?view=roles&role=${key}`} className={chip(key === role)}>
            {roleLabel(key)}
          </Link>
        ))}
      </nav>
      <div className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{roleLabel(role)}</h2>
        <p className="mt-1 text-table text-fg-muted">{roles[role].description}</p>
        <p className="mt-2 text-meta text-fg-subtle">
          A position is held with the role: managing a company branch or heading the group department widens it where the person works as {roleLabel(role)}, and nowhere else.
          {roles[role].readOnly ? " This role is read-only at every position." : ""}
        </p>
      </div>
      <div className="nesto-card p-0">
        <Table flush aria-label={`${roleLabel(role)} by position`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Module</TableHeaderCell>
              <TableHeaderCell>{positionLabels.MEMBER}</TableHeaderCell>
              <TableHeaderCell>{positionLabels.COMPANY_MANAGER}</TableHeaderCell>
              <TableHeaderCell>{positionLabels.GROUP_HEAD}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell>{access(row.member)}</TableCell>
                <TableCell className={cn(access(row.manager) !== access(row.member) && "font-medium text-accent-strong")}>{access(row.manager)}</TableCell>
                <TableCell className={cn(access(row.head) !== access(row.manager) && "font-medium text-accent-strong")}>{access(row.head)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

async function CheckView({ context, params }: { context: UserContext; params: Record<string, string | string[] | undefined> }) {
  const options = await accessCheckOptions(context);
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
    <section className="space-y-4" aria-label="Check access">
      <form method="get" action="/organization/access" className="nesto-card grid gap-4 p-5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <input type="hidden" name="view" value="check" />
        <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
          Person
          <select name="userId" defaultValue={one(params.userId) ?? ""} className={selectClass} required>
            <option value="">Choose a person</option>
            {options.people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name} ({person.username})
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
          Company
          <select name="targetCompanyId" defaultValue={one(params.targetCompanyId) ?? context.companyId} className={selectClass} required>
            {options.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
          Permission (optional)
          <Input name="permission" defaultValue={one(params.permission) ?? ""} placeholder="finance.payment.approve" />
        </label>
        <Button type="submit">Check</Button>
      </form>

      {notFound ? <EmptyState title="Nothing to check" description="That person or company is not part of your group." /> : null}
      {diagnosis ? <Diagnosis diagnosis={diagnosis} /> : null}
    </section>
  );
}

function Diagnosis({ diagnosis }: { diagnosis: AccessDiagnosisDTO }) {
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
            <PersonLink userId={diagnosis.person.userId} name={diagnosis.person.name} /> in {diagnosis.company.name}
          </h2>
          <span className="text-meta text-fg-subtle">
            {diagnosis.membership ? `${diagnosis.membership.role.label} · ${diagnosis.position.label}` : "No membership"}
          </span>
        </div>
        {diagnosis.blockers.length > 0 ? (
          <ul className="space-y-1" aria-label="Blockers">
            {diagnosis.blockers.map((blocker) => (
              <li key={blocker.code} className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
                {blocker.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-table text-fg-muted">Nothing blocks this person here: the account, the membership, the company and the group are all active.</p>
        )}
        {diagnosis.position.heldThrough.length > 0 ? (
          <p className="text-table text-fg-muted">
            Position held through:{" "}
            {diagnosis.position.heldThrough.map((row) => `${row.level}, ${row.department} (${row.where})`).join("; ")}.
          </p>
        ) : null}
        {diagnosis.grants.length > 0 ? (
          <p className="text-table text-fg-muted">
            Delegated here: {diagnosis.grants.map((grant) => `${grant.moduleLabel} ${LEVEL_LABELS[grant.accessLevel]} (${grant.scope === "GROUP" ? "group" : "company"})`).join(", ")}.
          </p>
        ) : null}
        {diagnosis.permission ? (
          <p className={cn("rounded-md border px-3 py-2 text-table", diagnosis.permission.held ? "border-success/30 bg-success-soft text-success-strong" : "border-line bg-surface-2 text-fg")} data-testid="permission-answer">
            <span className="font-mono">{diagnosis.permission.key}</span>: {reasons[diagnosis.permission.reason]}
          </p>
        ) : null}
      </div>

      <div className="nesto-card p-0">
        <Table flush aria-label="Module access">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Module</TableHeaderCell>
              <TableHeaderCell>By role</TableHeaderCell>
              <TableHeaderCell>With position</TableHeaderCell>
              <TableHeaderCell>In effect</TableHeaderCell>
              <TableHeaderCell>Because of</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {opened.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell>{access(row.role)}</TableCell>
                <TableCell>{access(row.position)}</TableCell>
                <TableCell className="font-medium">{access(row.effective)}</TableCell>
                <TableCell>{SOURCE_LABELS[row.source]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
