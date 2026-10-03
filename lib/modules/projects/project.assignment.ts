import { assignedCompanyId, assignedOnly } from "@/lib/access/project-ownership";
import type { ProjectStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule } from "@/lib/access/guards";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import * as repository from "./project.repository";

/**
 * Who may put a person on a project, or take them off it (PRD #10 §74;
 * E-06 §31-§33, §65, §66, §94, §120).
 *
 * Two doors to the one ProjectMember. Whoever runs the project's team holds
 * `project.member.add`/`remove` on a project in their scope, as before. A
 * department manager assigns their own people: a Company Department Manager
 * the members of their branch, to that company's projects; a Group Department
 * Head the members of their function in any company of the group. Either acts
 * as their membership in the project's company, so its projects, people and
 * audit log are the ones involved, and neither reaches a person outside the
 * department they manage — assigning work is not granting a function (§77).
 */

export type TeamChange = "add" | "remove";

export type TeamChangeAuthority = {
  acting: UserContext;
  project: { id: string; name: string; companyId: string; status: ProjectStatus; archivedAt: Date | null; projectManagerMemberId: string | null };
  member: { id: string; userId: string; name: string };
  via: "PROJECT" | "DEPARTMENT";
};

export async function authorizeTeamChange(
  session: UserContext,
  projectId: string,
  companyMemberId: string,
  change: TeamChange,
): Promise<TeamChangeAuthority> {
  const projectPermission = change === "add" ? "project.member.add" : "project.member.remove";
  const departmentPermission = change === "add" ? "department.project.assign" : "department.project.unassign";
  // A role with neither door is refused before anything is looked up (PRD #10 §133).
  if (!can(session, projectPermission) && !can(session, departmentPermission)) throw new AccessError("FORBIDDEN");

  const project = assignedOnly(await prisma.project.findFirst({
    where: { id: projectId, company: { parentGroupId: session.parentGroupId } },
    select: { id: true, name: true, companyId: true, status: true, archivedAt: true, projectManagerMemberId: true },
  }));
  if (!project) throw new AccessError("NOT_FOUND");
  const acting = await contextInCompany(session, assignedCompanyId(project));
  if (!acting) throw new AccessError("NOT_FOUND");
  assertModule(acting, "projects");

  const member = await prisma.companyMember.findFirst({
    where: { id: companyMemberId, companyId: assignedCompanyId(project), ...(change === "add" ? { status: "ACTIVE", user: { status: "ACTIVE" } } : {}) },
    select: { id: true, userId: true, departmentId: true, department: { select: { groupDepartmentId: true } }, user: { select: { firstName: true, lastName: true } } },
  });
  if (!member) {
    // Another company, no such person, or no active login: one answer (PRD #10 §74, E-06 §33).
    throw new AccessError("VALIDATION_ERROR", "That person cannot be added to this project.");
  }
  const found = { id: member.id, userId: member.userId, name: `${member.user.firstName} ${member.user.lastName}` };

  if (can(acting, projectPermission) && (await repository.findProjectInScope(acting, project.id))) {
    return { acting, project, member: found, via: "PROJECT" };
  }

  const manages = acting.assignments.some(
    (assignment) =>
      (assignment.positionLevel === "COMPANY_MANAGER" && assignment.companyId === project.companyId && member.departmentId !== null && assignment.companyDepartmentId === member.departmentId) ||
      (assignment.positionLevel === "GROUP_HEAD" && assignment.companyId === null && member.department?.groupDepartmentId === assignment.groupDepartmentId),
  );
  if (can(acting, departmentPermission) && manages) {
    return { acting, project, member: found, via: "DEPARTMENT" };
  }

  // Somebody who can see the project is told no; everybody else, that there is nothing here.
  if (await repository.findProjectInScope(acting, project.id)) throw new AccessError("FORBIDDEN");
  throw new AccessError("NOT_FOUND");
}
