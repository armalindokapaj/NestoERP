import type { Metadata } from "next";
import Link from "next/link";

import { ModuleShell, resolveTab } from "@/components/modules/module-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { modules } from "@/config/modules";
import { roleLabel } from "@/config/roles";
import { requirePermission } from "@/lib/auth/session";
import { getTeamMembers } from "@/lib/database/queries";
import { fullName } from "@/lib/utils/format";

const MODULE_KEY = "team" as const;

export const metadata: Metadata = {
  title: modules[MODULE_KEY].label,
};

/** Team directory — real company data, minimally usable in V0.1 (spec §44). */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission(modules[MODULE_KEY].viewPermission);
  const { tab } = await searchParams;
  const activeTab = resolveTab(MODULE_KEY, tab);

  const members = await getTeamMembers(user.companyId);

  const departments = members.reduce<Record<string, typeof members>>((groups, member) => {
    const key = member.department ?? "Unassigned";
    groups[key] = groups[key] ?? [];
    groups[key].push(member);
    return groups;
  }, {});

  return (
    <ModuleShell moduleKey={MODULE_KEY} activeTab={activeTab}>
      {activeTab === "members" ? (
        <div className="nesto-card overflow-hidden">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Employee</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Email</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Department</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <Link
                      href={`/team/${member.userId}`}
                      className="flex items-center gap-2.5 transition-colors hover:text-accent"
                    >
                      <Avatar
                        firstName={member.firstName}
                        lastName={member.lastName}
                        src={member.avatar}
                        size="sm"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {fullName(member.firstName, member.lastName)}
                        </span>
                        <span className="block truncate text-meta text-fg-subtle">
                          {member.jobTitle}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-fg-muted md:table-cell">{member.email}</TableCell>
                  <TableCell className="text-fg-muted">{roleLabel(member.role)}</TableCell>
                  <TableCell className="hidden text-fg-muted lg:table-cell">
                    {member.department ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge tone={member.status === "ACTIVE" ? "success" : "default"}>
                      {member.status === "ACTIVE" ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {activeTab === "departments" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(departments).map(([department, people]) => (
            <section key={department} className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">{department}</h2>
                <Badge>{people.length}</Badge>
              </div>
              <ul className="mt-3 divide-y divide-line">
                {people.map((member) => (
                  <li key={member.id} className="py-2 first:pt-0 last:pb-0">
                    <Link
                      href={`/team/${member.userId}`}
                      className="block truncate text-table text-fg transition-colors hover:text-accent"
                    >
                      {fullName(member.firstName, member.lastName)}
                    </Link>
                    <p className="truncate text-meta text-fg-subtle">{roleLabel(member.role)}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </ModuleShell>
  );
}
