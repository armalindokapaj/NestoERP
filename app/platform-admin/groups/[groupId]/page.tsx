import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";

import { StatusBadge } from "@/components/modules/status-badge";
import { GroupImplementationActions } from "@/components/platform/platform-actions";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Implementation" };

type Props = { params: Promise<{ groupId: string }> };

/**
 * A group's implementation (E-06 §21, §70, §71): its identity, its companies,
 * the initial roster, the checklist the platform hands it over against, and
 * the controls that move it along. Configuration only — never business records.
 */
export default async function GroupImplementationPage({ params }: Props) {
  const { groupId } = await params;
  const context = await requirePlatformContext();
  const implementation = await getGroupImplementation(context, groupId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { group } = implementation;

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-meta text-fg-subtle">
        <Link href="/platform-admin" className="hover:text-fg hover:underline">
          Parent groups
        </Link>{" "}
        / {group.name}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg">{group.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted">
            <StatusBadge status={group.status} />
            <span className="font-mono text-meta">{group.slug}</span>
            {group.activatedAt ? <span>Active since {formatDate(group.activatedAt)}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><GroupImplementationActions implementation={implementation} />
          {/* The tenant's mark in its sidebar (OW §12, §44); the group's name is its display name. */}
          {group.status !== "ARCHIVED" ? <PlatformCommandButton label="Branding" title={`${group.name} branding`} description="The logo leads the tenant's sidebar, beside the group's name. Without one, the group's initials stand in." action="group.branding" fixed={{ groupId: group.id }} fields={[{ name: "logoUrl", label: "Logo", type: "textarea", hint: "A path on this deployment (/branding/logo.svg) or an inline image (data:image/png;base64,…), shown square at the top of the sidebar. Leave empty for initials." }, { name: "reason", label: "Reason", type: "textarea", required: true }]} initial={{ logoUrl: group.logoUrl ?? "" }} success="Group branding saved." /> : null}
          <PlatformCommandButton label="Lifecycle" title={`Change ${group.name} lifecycle`} description="Suspension immediately ends tenant sessions. Archiving preserves the tenant as read-only history." action="group.status" fixed={{ groupId: group.id }} fields={[{ name: "status", label: "Status", type: "select", required: true, options: (group.status === "SUSPENDED" ? ["ACTIVE", "ARCHIVED"] : ["SUSPENDED", "ARCHIVED"]).map((value) => ({ value, label: value })) }, { name: "reason", label: "Reason", type: "textarea", required: true }]} initial={{ status: group.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED" }} destructive success="Group lifecycle changed." />
        </div>
      </div>

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
        <Link href={`/platform-admin/groups/${group.id}/departments`} className="text-table font-medium text-accent-strong hover:underline">
          Set up departments
        </Link>
      </section>

      <section className="nesto-card p-5" aria-labelledby="group-companies">
        <h2 id="group-companies" className="text-card font-semibold text-fg">
          Companies
        </h2>
        {implementation.companies.length === 0 ? (
          <p className="mt-3 text-table text-fg-muted">No company yet.</p>
        ) : (
          <Table flush className="mt-3" aria-labelledby="group-companies">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Company</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Departments</TableHeaderCell>
                <TableHeaderCell>With a manager</TableHeaderCell>
                <TableHeaderCell>People</TableHeaderCell>
                <TableHeaderCell>Projects</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {implementation.companies.map((company) => (
                <TableRow key={company.id} data-testid="implementation-company">
                  <TableCell>
                    <p className="font-medium text-fg">{company.name}</p>
                    <p className="font-mono text-meta text-fg-subtle">{company.slug}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={company.status} />
                  </TableCell>
                  <TableCell className="tabular-nums">{company.branches}</TableCell>
                  <TableCell className="tabular-nums">{company.branches === 0 ? "—" : `${company.managers} of ${company.branches}`}</TableCell>
                  <TableCell className="tabular-nums">{company.members}</TableCell>
                  <TableCell>{company.projects.length === 0 ? "—" : company.projects.map((project) => project.name).join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="nesto-card p-5" aria-labelledby="group-people">
        <h2 id="group-people" className="text-card font-semibold text-fg">
          People
        </h2>
        {implementation.people.length === 0 ? (
          <p className="mt-3 text-table text-fg-muted">Nobody yet. Add the approved initial roster.</p>
        ) : (
          <Table flush className="mt-3" aria-labelledby="group-people">
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
