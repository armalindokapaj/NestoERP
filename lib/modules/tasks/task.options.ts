import { buildProjectScopeWhere } from "@/lib/access/scope";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Options for the task form (PRD #11 §36, §37).
 *
 * Both lists are read inside the current company and the user's own project
 * scope, so a form cannot offer a relationship the service would then refuse
 * (PRD #11 §221).
 *
 * Without `task.assign` the assignee list collapses to the current user alone:
 * a broad company directory is not offered to somebody who may only take work
 * themselves (PRD #11 §37, §122).
 */
export async function taskFormOptions(context: UserContext, selectedProjectId?: string | null) {
  const mayAssignOthers = can(context, "task.assign");

  const projects = await prisma.project.findMany({
    where: {
      AND: [buildProjectScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  const assignees = await loadAssignees(context, mayAssignOthers, selectedProjectId ?? null);

  return {
    projects: projects.map((project) => ({
      value: project.id,
      label: `${project.name} (${project.code})`,
    })),
    assignees,
    mayAssignOthers,
  };
}

async function loadAssignees(
  context: UserContext,
  mayAssignOthers: boolean,
  projectId: string | null,
) {
  if (!mayAssignOthers) {
    return [{ value: context.membershipId, label: `${context.fullName} (you)` }];
  }

  // Project work goes to the project team, so the picker offers exactly the
  // people the service will accept (PRD #11 §48).
  const members = await prisma.companyMember.findMany({
    where: {
      companyId: context.companyId,
      status: "ACTIVE",
      ...(projectId
        ? {
            OR: [
              { projectMemberships: { some: { projectId, status: "ACTIVE" } } },
              { managedProjects: { some: { id: projectId } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true } },
      role: { select: { name: true } },
    },
    orderBy: [{ user: { firstName: "asc" } }],
  });

  return members.map((member) => ({
    value: member.id,
    label:
      member.id === context.membershipId
        ? `${member.user.firstName} ${member.user.lastName} (you)`
        : `${member.user.firstName} ${member.user.lastName} — ${member.role.name}`,
  }));
}
