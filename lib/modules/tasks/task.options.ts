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

  const assignees = await loadAssignees(
    context,
    mayAssignOthers,
    await projectInScope(context, selectedProjectId ?? null),
  );

  return {
    projects: projects.map((project) => ({
      value: project.id,
      label: `${project.name} (${project.code})`,
    })),
    assignees,
    mayAssignOthers,
  };
}

/**
 * The assignee picker's options for one project, asked for again when the
 * form's project changes (AUD-09 §5, FV-08). `null` means no project: any
 * active member (or only yourself, without `task.assign`). A project the
 * reader cannot reach — or one archived since the form opened — answers
 * `unavailable` rather than the company directory, so a guessed id learns
 * nothing about a team (PRD #47 §62).
 */
export async function taskAssigneeOptions(
  context: UserContext,
  projectId: string | null,
): Promise<{ ok: true; options: Array<{ value: string; label: string }> } | { ok: false; code: "PROJECT_UNAVAILABLE" }> {
  const mayAssignOthers = can(context, "task.assign");
  if (!projectId) return { ok: true, options: await loadAssignees(context, mayAssignOthers, null) };
  const project = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId, archivedAt: null, status: { not: "ARCHIVED" } }] },
    select: { id: true },
  });
  if (!project) return { ok: false, code: "PROJECT_UNAVAILABLE" };
  return { ok: true, options: await loadAssignees(context, mayAssignOthers, project.id) };
}

/**
 * The selected project, only when the reader can reach it (PRD #47 §62).
 *
 * The id arrives from a query string. Listing "the team of project X" for an id
 * the reader cannot open would publish that team to anybody who guessed or
 * copied the id, so an out-of-scope project is treated as no project at all.
 * Archived projects stay in: editing a task on one still needs its team.
 */
async function projectInScope(context: UserContext, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: { id: true },
  });
  return project?.id ?? null;
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
