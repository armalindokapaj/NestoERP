import type { Prisma } from "@prisma/client";

import { GROUP_DEPARTMENTS } from "@/config/group-departments";

/** A member's place in the branch they are placed in (E-13 §24-§29, ADR 0003). */
export async function memberPlace(
  tx: Prisma.TransactionClient,
  input: { parentGroupId: string; userId: string; companyId: string; branch: { id: string; groupDepartmentId: string | null }; roleKey: string; actorUserId: string },
): Promise<void> {
  if (!input.branch.groupDepartmentId) return;
  await tx.departmentAssignment.create({
    data: { parentGroupId: input.parentGroupId, userId: input.userId, groupDepartmentId: input.branch.groupDepartmentId, companyId: input.companyId, companyDepartmentId: input.branch.id, functionalRoleKey: input.roleKey, positionLevel: "MEMBER", accessLevel: "CONTRIBUTE", status: "ACTIVE", startsAt: new Date(), createdByUserId: input.actorUserId },
  });
}

/** The department a role works in (§47): Owner and CEO in Executive, Finance in Finance. */
export function departmentKeyFor(role: string): string {
  return GROUP_DEPARTMENTS.find((department) => (department.roles as readonly string[]).includes(role))?.key ?? "executive";
}

/**
 * Serialises changes to a group's leadership (PRD #14 §82, §85). The Group CEO
 * is one person, and "the last CEO" is a fact about the whole group, so every
 * transaction that adds, replaces, suspends or removes a seat holds this lock
 * before it reads who the CEO is. Two administrators acting at once queue up
 * and the second one sees the first one's result.
 */
export async function lockGroup(tx: Prisma.TransactionClient, groupId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM parent_groups WHERE id = ${groupId} FOR UPDATE`;
}
