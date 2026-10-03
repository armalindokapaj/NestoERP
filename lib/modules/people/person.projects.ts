import { assignedCompany, assignedCompanyId } from "@/lib/access/project-ownership";
import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { authorizeTeamChange } from "@/lib/modules/projects/project.assignment";
import { addMember, removeMember } from "@/lib/modules/projects/project.service";
import { getWorkProfile } from "./people.service";

/**
 * Putting a person on a project from their profile (E-08 §49, §50, §64).
 *
 * Nothing new decides who may: the project's own team door and a department
 * manager's (E-06 §94) do, through `authorizeTeamChange`, exactly as on the
 * project's Team tab. This only finds which of the person's companies' projects
 * this reader may assign them to or take them off, and acts through the
 * projects module's own door, which re-checks and audits.
 */

export type AssignableProjectDTO = { projectId: string; code: string; name: string; company: { id: string; name: string } };

const MAX_CANDIDATES = 40;

/** The person's active memberships in the group, company by company. */
async function membershipsOf(context: UserContext, personId: string) {
  const person = await prisma.personProfile.findFirst({
    where: { id: personId, parentGroupId: context.parentGroupId },
    select: { user: { select: { status: true, memberships: { where: { status: "ACTIVE", company: { parentGroupId: context.parentGroupId, status: "ACTIVE" } }, select: { id: true, companyId: true } } } } },
  });
  if (!person?.user || person.user.status !== "ACTIVE") return new Map<string, string>();
  return new Map(person.user.memberships.map((membership) => [membership.companyId, membership.id]));
}

async function allowed(context: UserContext, projectId: string, companyMemberId: string, change: "add" | "remove"): Promise<boolean> {
  try {
    await authorizeTeamChange(context, projectId, companyMemberId, change);
    return true;
  } catch (error) {
    if (error instanceof AccessError) return false;
    throw error;
  }
}

/** Projects this reader may put the person on (§49, §50): in a company where the person works, not already on it. */
export async function assignableProjects(context: UserContext, personId: string): Promise<AssignableProjectDTO[]> {
  assertModule(context, "people");
  assertPermission(context, "people.profile.view");
  if (!can(context, "project.member.add") && !can(context, "department.project.assign")) return [];
  const profile = await getWorkProfile(context, personId);
  if (profile.former) return [];
  const memberships = await membershipsOf(context, personId);
  if (memberships.size === 0) return [];
  const candidates = await prisma.project.findMany({
    where: {
      companyId: { in: [...memberships.keys()] },
      archivedAt: null,
      status: { in: ["PENDING", "ACTIVE"] },
      members: { none: { status: "ACTIVE", companyMemberId: { in: [...memberships.values()] } } },
    },
    select: { id: true, code: true, name: true, companyId: true, company: { select: { id: true, name: true } } },
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
    take: MAX_CANDIDATES,
  });
  const result: AssignableProjectDTO[] = [];
  for (const project of candidates) {
    if (await allowed(context, project.id, memberships.get(assignedCompanyId(project))!, "add")) result.push({ projectId: project.id, code: project.code, name: project.name, company: assignedCompany(project) });
  }
  return result;
}

/** The projects the person is on that this reader may take them off (§64). */
export async function removableProjectIds(context: UserContext, personId: string): Promise<string[]> {
  if (!can(context, "project.member.remove") && !can(context, "department.project.unassign")) return [];
  const memberships = await membershipsOf(context, personId);
  if (memberships.size === 0) return [];
  const rows = await prisma.projectMember.findMany({
    where: { companyMemberId: { in: [...memberships.values()] }, status: "ACTIVE", project: { archivedAt: null } },
    select: { projectId: true, companyMemberId: true },
    take: MAX_CANDIDATES,
  });
  const result: string[] = [];
  for (const row of rows) if (await allowed(context, row.projectId, row.companyMemberId, "remove")) result.push(row.projectId);
  return result;
}

/** Puts the person on a project, as their membership in the project's company (§49, §64). */
export async function assignPersonToProject(context: UserContext, personId: string, input: { projectId: string; projectRole?: string | null }): Promise<void> {
  assertModule(context, "people");
  await getWorkProfile(context, personId);
  const project = await prisma.project.findFirst({ where: { id: input.projectId, company: { parentGroupId: context.parentGroupId } }, select: { companyId: true } });
  if (!project) throw new AccessError("NOT_FOUND");
  const companyMemberId = (await membershipsOf(context, personId)).get(assignedCompanyId(project));
  if (!companyMemberId) throw new AccessError("VALIDATION_ERROR", "They have no login in that project's company.", { code: "NO_MEMBERSHIP" });
  await addMember(context, input.projectId, { companyMemberId, projectRole: input.projectRole ?? undefined });
}

/** Takes the person off a project (§64). */
export async function unassignPersonFromProject(context: UserContext, personId: string, projectId: string): Promise<void> {
  assertModule(context, "people");
  await getWorkProfile(context, personId);
  const memberships = [...(await membershipsOf(context, personId)).values()];
  const row = await prisma.projectMember.findFirst({ where: { projectId, companyMemberId: { in: memberships }, status: "ACTIVE" }, select: { id: true } });
  if (!row) throw new AccessError("NOT_FOUND");
  await removeMember(context, projectId, row.id);
}
