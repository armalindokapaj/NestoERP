import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ProjectTeam } from "@/components/projects/project-team";
import { can } from "@/lib/access/can";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Team" };

/** Project team (PRD #10 §69, §70). */
export default async function ProjectTeamPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  if (!actions.canViewMembers) redirect("/access-denied");

  const canAdd = can(context, "project.member.add");
  const [members, assignable] = await Promise.all([
    projects.listMembers(context, projectId),
    canAdd ? projects.assignableMembers(context, projectId) : Promise.resolve([]),
  ]);

  // Only fetched for the people the dialog can actually offer to remove.
  const openTaskCounts: Record<string, number> = {};
  if (can(context, "project.member.remove")) {
    await Promise.all(
      members
        .filter((member) => member.status === "ACTIVE")
        .map(async (member) => {
          openTaskCounts[member.companyMemberId] = await projects.openTasksForMember(
            context,
            projectId,
            member.companyMemberId,
          );
        }),
    );
  }

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Team")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
      />

      <ProjectTabs
        projectId={project.id}
        active="team"
        show={{
          planning: actions.canViewPlanning,
          contractors: actions.canViewContractors,
          engineering: actions.canViewEngineering,
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          dailyLogs: actions.canViewDailyLogs,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      <ProjectTeam
        projectId={project.id}
        members={members}
        managerMemberId={project.projectManager?.memberId ?? null}
        assignable={assignable.map((member) => ({
          id: member.id,
          name: `${member.user.firstName} ${member.user.lastName}`,
          detail: [member.role.name, member.department?.name].filter(Boolean).join(" · "),
        }))}
        canAdd={canAdd && project.archivedAt === null}
        canUpdate={can(context, "project.member.update") && project.archivedAt === null}
        canRemove={can(context, "project.member.remove") && project.archivedAt === null}
        openTaskCounts={openTaskCounts}
      />
    </div>
  );
}
