import Link from "@/components/navigation/nav-link";
import { CheckCircle2, Circle } from "lucide-react";

import { GroupImplementationActions } from "@/components/platform/platform-actions";
import { PlatformCommandMenu } from "@/components/platform/platform-command";
import { RECOVERY_RETENTION_DAYS } from "@/lib/modules/platform/recovery-constants";
import { deleteItem, purgeItem, restoreItem } from "./recovery-actions";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";

type Props = { implementation: Awaited<ReturnType<typeof getGroupImplementation>> };

/**
 * A group's implementation (E-06 §21, §70, §71): its identity, its companies,
 * the initial roster, the checklist the platform hands it over against, and
 * the controls that move it along. Configuration only — never business records.
 */
/** The group's own controls, in the page header (Organizations PRD §20, §52). */
export function GroupHeaderActions({ implementation }: Props) {
  const { group } = implementation;
  // A group suspended before its handover resumes into setup; only the checklist activates it (ADM audit §2).
  const resumeTo = group.activatedAt ? "ACTIVE" : "IMPLEMENTING";
  if (group.status === "DELETED") {
    return <PlatformCommandMenu label={`${group.name} actions`} items={[restoreItem({ kind: "group", id: group.id, name: group.name }), purgeItem({ kind: "group", id: group.id, name: group.name })]} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <GroupImplementationActions implementation={implementation} />
      <PlatformCommandMenu
        label={`${group.name} actions`}
        items={[
          // The tenant's mark in its sidebar (OW §12, §44); the group's name is its display name.
          ...(group.status !== "ARCHIVED" ? [{ label: "Branding", title: `${group.name} branding`, description: "The logo leads the tenant's sidebar, beside the group's name. Without one, the group's initials stand in.", action: "group.branding", fixed: { groupId: group.id }, fields: [{ name: "logoUrl", label: "Logo", type: "textarea" as const, hint: "A path on this deployment (/branding/logo.svg) or an inline image (data:image/png;base64,…), shown square at the top of the sidebar. Leave empty for initials." }, { name: "reason", label: "Reason", type: "textarea" as const, required: true }], initial: { logoUrl: group.logoUrl ?? "" }, submitLabel: "Save", success: "Group branding saved." }] : []),
          ...(group.status !== "ARCHIVED" ? [{ label: group.status === "SUSPENDED" ? "Resume or archive" : "Suspend or archive", title: `Change ${group.name} lifecycle`, description: "Suspension immediately ends tenant sessions. Archiving preserves the tenant as read-only history.", action: "group.status", fixed: { groupId: group.id }, fields: [{ name: "status", label: "Status", type: "select" as const, required: true, options: (group.status === "SUSPENDED" ? [resumeTo, "ARCHIVED"] : ["SUSPENDED", "ARCHIVED"]).map((value) => ({ value, label: value === "IMPLEMENTING" ? "IMPLEMENTING (resume setup)" : value })) }, { name: "reason", label: "Reason", type: "textarea" as const, required: true }], initial: { status: group.status === "SUSPENDED" ? resumeTo : "SUSPENDED" }, destructive: true, submitLabel: "Change Lifecycle", success: "Group lifecycle changed." }] : []),
          deleteItem({ kind: "group", id: group.id, name: group.name }, RECOVERY_RETENTION_DAYS),
        ]}
      />
    </div>
  );
}

/** The Overview tab: implementation state, departments and the initial roster (§23). */
export function GroupOverview({ implementation }: Props) {
  const { group } = implementation;
  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="implementation-checklist">
        <h2 id="implementation-checklist" className="text-card font-semibold text-fg">
          Implementation checklist
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="implementation-checklist">
          {implementation.checklist.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-table" data-testid="checklist-item" data-done={item.done}>
              {item.done ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
              <span className={item.done ? "text-fg" : "text-fg-muted"}>
                {item.label}
                {!item.blocking ? <span className="ml-1 text-meta text-fg-subtle">(recommended)</span> : null}
                <span className="sr-only">{item.done ? " — done" : " — not done"}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="nesto-card flex flex-wrap items-center justify-between gap-3 p-5" aria-labelledby="group-departments">
        <div>
          <h2 id="group-departments" className="text-card font-semibold text-fg">
            Departments
          </h2>
          <p className="mt-1 text-table text-fg-muted" data-testid="department-setup">
            {implementation.departments.active} departments, {implementation.departments.branches} active in companies · heads for {implementation.departments.withHead} of {implementation.departments.needingHead} ·
            managers for {implementation.departments.branchesWithManager} of {implementation.departments.branches} company departments
          </p>
        </div>
        <Link href={`/admin/organizations/${group.id}/departments`} className="text-table font-medium text-accent-strong hover:underline">
          Set up departments
        </Link>
      </section>

      <section className="nesto-card p-5" aria-labelledby="group-people">
        <h2 id="group-people" className="text-card font-semibold text-fg">
          People
        </h2>
        {implementation.people.length === 0 ? (
          <p className="mt-3 text-table text-fg-muted">Nobody yet. Add the approved initial roster.</p>
        ) : (
          <Table stack flush className="mt-3" aria-labelledby="group-people">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Person</TableHeaderCell>
                <TableHeaderCell>Username</TableHeaderCell>
                <TableHeaderCell>Where</TableHeaderCell>
                <TableHeaderCell>Password</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {implementation.people.map((person) => (
                <TableRow key={person.userId} data-testid="implementation-person">
                  <TableCell className="font-medium">{person.name}</TableCell>
                  <TableCell className="font-mono text-meta">{person.username}</TableCell>
                  <TableCell>{person.placements.join("; ")}</TableCell>
                  <TableCell>{person.mustChangePassword ? "Temporary" : "Set by them"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
