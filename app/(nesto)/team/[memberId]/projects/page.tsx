import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import * as team from "@/lib/modules/team/team.service";
import type { TeamMemberProjectDTO } from "@/lib/modules/team/team.types";
import { orDash } from "@/lib/utils/format";
import { loadMember, memberBreadcrumbs } from "../member-context";
import { MemberTabs } from "../member-tabs";

type Params = { params: Promise<{ memberId: string }> };

export const metadata: Metadata = { title: "Member projects" };

/**
 * The projects a member works on (PRD #14 §46, §52).
 *
 * Narrowed twice: to this member's assignments, and to the projects the
 * *reader* may see. A project this reader has no access to is absent, so the
 * page can never be used to enumerate the company's work (PRD #14 §52).
 */
export default async function MemberProjectsPage({ params }: Params) {
  const { memberId } = await params;
  const { context, member } = await loadMember(memberId);

  const projects = await team.listMemberProjects(context, memberId);

  const columns: TableColumn<TeamMemberProjectDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: "Project",
      primary: true,
      render: (project) => (
        <span className="min-w-0">
          <span className="block truncate">{project.name}</span>
          <span className="block truncate text-meta font-normal text-fg-subtle">
            {project.code}
          </span>
        </span>
      ),
    },
    {
      key: "role",
      id: "role",
      label: "Project role",
      render: (project) => (
        <span className="flex items-center gap-2 text-fg-muted">
          {orDash(project.projectRole)}
          {project.isManager ? <Badge tone="info">Manager</Badge> : null}
        </span>
      ),
    },
    {
      key: "status",
      id: "status",
      valueType: "status",
      label: "Status",
      render: (project) => <StatusBadge status={project.status} />,
    },
  ];

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={memberBreadcrumbs(member, "Projects")}
        title={member.profile.fullName}
        subtitle={member.membership.role.name}
        status={member.membership.status}
      />

      <MemberTabs
        memberId={member.id}
        active="projects"
        show={{ projects: true, activity: member.capabilities.canViewActivity }}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No projects in your view."
          description="Projects this person works on that you can also see will appear here."
        />
      ) : (
        <DataTable
      listId="team.member-projects"
          caption={`Projects for ${member.profile.fullName}`}
          columns={columns}
          records={projects}
          rowKey={(project) => project.id}
          rowHref={(project) => `/projects/${project.id}`}
        />
      )}
    </div>
  );
}
