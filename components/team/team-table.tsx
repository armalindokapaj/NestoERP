import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { Avatar } from "@/components/ui/avatar";
import type { TeamMemberSummaryDTO } from "@/lib/modules/team/team.types";
import { formatDate, orDash } from "@/lib/utils/format";

/**
 * The Team directory (PRD #14 §32, §212).
 *
 * Safe membership information only: name, role, department, job title, status
 * and the projects this reader can see. Salary, bank details, identifiers,
 * home address and medical data belong to HR and never appear here
 * (PRD #14 §44, §174).
 */
export function TeamTable({
  members,
  showLastLogin = false,
}: {
  members: TeamMemberSummaryDTO[];
  /** Only with team.member.security_metadata.view (PRD #14 §49). */
  showLastLogin?: boolean;
}) {
  const columns: TableColumn<TeamMemberSummaryDTO>[] = [
    {
      key: "name",
      label: "Member",
      primary: true,
      render: (member) => (
        <span className="flex items-center gap-2.5">
          <Avatar
            firstName={member.name.firstName}
            lastName={member.name.lastName}
            src={member.avatarUrl}
            size="sm"
          />
          <span className="min-w-0">
            <span className="block truncate">{member.name.fullName}</span>
            <span className="block truncate text-meta font-normal text-fg-subtle">
              {member.email}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "role",
      label: "Role",
      render: (member) => <span className="text-fg-muted">{member.role.name}</span>,
    },
    {
      key: "department",
      label: "Department",
      hideBelow: "lg",
      render: (member) => <span className="text-fg-muted">{orDash(member.department?.name)}</span>,
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
    {
      key: "projects",
      label: "Projects",
      hideBelow: "lg",
      align: "right",
      render: (member) => <span className="text-fg-muted">{member.projectCount}</span>,
    },
    ...(showLastLogin
      ? [
          {
            key: "lastLogin",
            label: "Last login",
            hideBelow: "xl" as const,
            render: (member: TeamMemberSummaryDTO) => (
              <span className="text-fg-muted">
                {member.lastLoginAt ? formatDate(member.lastLoginAt) : "—"}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      caption="Team members"
      columns={columns}
      records={members}
      rowKey={(member) => member.id}
      rowHref={(member) => `/team/${member.id}`}
    />
  );
}
