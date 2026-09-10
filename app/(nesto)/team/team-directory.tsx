import Link from "next/link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import { getDepartments, getTeamMembers, type TeamMember } from "@/lib/database/queries";
import { orDash } from "@/lib/utils/format";

/**
 * Team directory (PRD #5 §37).
 *
 * Basic information — name, role, department, status — is widely visible;
 * sensitive HR detail lives behind the HR module's own permissions.
 */
export async function TeamPeople({ context }: { context: UserContext }) {
  const members = await getTeamMembers(context.companyId);

  if (members.length === 0) {
    return <EmptyState title="No team members yet." description="People added to your company workspace will appear here." />;
  }

  const columns: TableColumn<TeamMember>[] = [
    {
      key: "name",
      label: "Name",
      primary: true,
      render: (member) => (
        <span className="flex items-center gap-2.5">
          <Avatar
            firstName={member.firstName}
            lastName={member.lastName}
            src={member.avatarUrl}
            size="sm"
          />
          <span className="truncate">{member.fullName}</span>
        </span>
      ),
    },
    {
      key: "role",
      label: "Role",
      render: (member) => <span className="text-fg-muted">{member.roleName}</span>,
    },
    {
      key: "department",
      label: "Department",
      hideBelow: "lg",
      render: (member) => <span className="text-fg-muted">{orDash(member.department)}</span>,
    },
    {
      key: "jobTitle",
      label: "Job title",
      hideBelow: "xl",
      render: (member) => <span className="text-fg-muted">{orDash(member.jobTitle)}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (member) => <StatusBadge status={member.status} />,
    },
  ];

  return (
    <DataTable
      caption="Team members"
      columns={columns}
      records={members}
      rowKey={(member) => member.id}
      rowHref={(member) => `/team/${member.userId}`}
    />
  );
}

export async function TeamDepartments({ context }: { context: UserContext }) {
  const departments = await getDepartments(context.companyId);

  if (departments.length === 0) {
    return <EmptyState title="No departments yet." description="Departments configured for your company will appear here." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {departments.map((department) => (
        <Link
          key={department.id}
          href="/team"
          className="nesto-card p-5 transition-colors hover:border-line-strong"
        >
          <p className="text-card font-semibold text-fg">{department.name}</p>
          <p className="mt-2 text-page font-semibold tabular-nums text-fg">
            {department._count.members}
          </p>
          <p className="text-meta text-fg-subtle">
            member{department._count.members === 1 ? "" : "s"}
          </p>
        </Link>
      ))}
    </div>
  );
}
