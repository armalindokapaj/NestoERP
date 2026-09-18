import type { DepartmentStatus, Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";

/**
 * Team's doors for a company's branch of a group department (E-06 §12, §13;
 * E-13 §17-§20, ADR 0003).
 *
 * Team owns the branch row (`Department`) and the membership that is placed in
 * it; the organization decides when a branch exists, what it is called, who
 * manages it and who is placed in it, and asks through these. Nothing here
 * checks authority — the caller has — and nothing here deletes: a branch is
 * closed and reopened, never removed (E-13 §18, §19).
 */

export type OpenedBranch = { id: string; created: boolean; previousStatus: DepartmentStatus | null };

/**
 * A group department activated in one company (E-13 §17, §19, §137): its
 * branch is created, or the one it had is reopened — the same row, so its
 * members, manager history and every reference to it are still there.
 * Opening an open branch changes nothing.
 */
export async function openBranch(
  tx: Prisma.TransactionClient,
  input: { companyId: string; groupDepartment: { id: string; key: string; name: string }; actorUserId: string | null },
): Promise<OpenedBranch> {
  const existing = await tx.department.findFirst({
    where: { companyId: input.companyId, groupDepartmentId: input.groupDepartment.id },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status === "ACTIVE") return { id: existing.id, created: false, previousStatus: "ACTIVE" };
    await tx.department.updateMany({
      where: { id: existing.id, companyId: input.companyId, status: existing.status },
      data: { status: "ACTIVE", preArchiveStatus: null, archivedAt: null, archivedBy: null, updatedBy: input.actorUserId },
    });
    return { id: existing.id, created: false, previousStatus: existing.status };
  }

  // A department the company made for itself before E-06 may hold the name.
  const clash = await tx.department.findFirst({
    where: { companyId: input.companyId, OR: [{ name: input.groupDepartment.name }, { key: input.groupDepartment.key }] },
    select: { name: true },
  });
  if (clash) {
    throw new AccessError("CONFLICT", `The company already has its own department called ${clash.name}. Rename it before activating the group's.`, { code: "BRANCH_NAME_TAKEN" });
  }
  const created = await tx.department.create({
    data: {
      companyId: input.companyId,
      name: input.groupDepartment.name,
      key: input.groupDepartment.key,
      groupDepartmentId: input.groupDepartment.id,
      status: "ACTIVE",
      createdBy: input.actorUserId,
    },
    select: { id: true },
  });
  return { id: created.id, created: true, previousStatus: null };
}

/** A branch closed (E-13 §18): kept, with its people and history. False when it was not open. */
export async function closeBranch(tx: Prisma.TransactionClient, input: { departmentId: string; companyId: string; actorUserId: string | null }): Promise<boolean> {
  const closed = await tx.department.updateMany({
    where: { id: input.departmentId, companyId: input.companyId, status: "ACTIVE" },
    data: { status: "INACTIVE", updatedBy: input.actorUserId },
  });
  return closed.count > 0;
}

/** A group department renamed: every company's branch carries the group's name (E-13 §3). */
export async function renameBranches(tx: Prisma.TransactionClient, input: { groupDepartmentId: string; name: string; actorUserId: string | null }): Promise<void> {
  await tx.department.updateMany({ where: { groupDepartmentId: input.groupDepartmentId }, data: { name: input.name, updatedBy: input.actorUserId } });
}

/**
 * A branch names its manager, as the Team module always has; the position
 * itself is the organization's department assignment (E-06 §13, §37). Ending an
 * appointment clears the name only if it is still theirs, so a later
 * appointment is never undone by an earlier one ending.
 */
export async function nameBranchManager(tx: Prisma.TransactionClient, input: { departmentId: string; companyId: string; memberId: string }): Promise<void> {
  await tx.department.updateMany({ where: { id: input.departmentId, companyId: input.companyId }, data: { managerMemberId: input.memberId } });
}

export async function clearBranchManager(tx: Prisma.TransactionClient, input: { departmentId: string; companyId: string; memberId: string }): Promise<void> {
  await tx.department.updateMany({ where: { id: input.departmentId, companyId: input.companyId, managerMemberId: input.memberId }, data: { managerMemberId: null } });
}

/**
 * A membership's home branch (ADR 0003): the department its company-scoped
 * work is placed in. Somebody added to a branch of a company they work in, and
 * not yet placed anywhere there, is placed in it.
 */
export async function placeHomeIfUnplaced(tx: Prisma.TransactionClient, input: { companyId: string; userId: string; departmentId: string }): Promise<void> {
  await tx.companyMember.updateMany({
    where: { companyId: input.companyId, userId: input.userId, departmentId: null },
    data: { departmentId: input.departmentId },
  });
}

/**
 * A membership placed where the person's employment says they work (E-03
 * §180, §187; ADR 0004): HR's employment record is the authority for the
 * department and job title of somebody it employs, and the membership carries
 * the same two facts for everything that reads Team. Only these two columns;
 * the NESTO role is never a consequence of a job change (E-03 §107).
 */
export async function setMemberPlacement(
  tx: Prisma.TransactionClient,
  input: { companyId: string; memberId: string; departmentId: string | null; jobTitle: string | null },
): Promise<void> {
  await tx.companyMember.updateMany({
    where: { id: input.memberId, companyId: input.companyId },
    data: { departmentId: input.departmentId, jobTitle: input.jobTitle },
  });
}

/**
 * Somebody taken off the branch that is their home is placed in the next
 * branch they still belong to in that company, or nowhere. Only if the home is
 * still that branch: a move somebody else made in between is not undone.
 */
export async function moveHome(tx: Prisma.TransactionClient, input: { companyId: string; userId: string; fromDepartmentId: string; toDepartmentId: string | null }): Promise<void> {
  await tx.companyMember.updateMany({
    where: { companyId: input.companyId, userId: input.userId, departmentId: input.fromDepartmentId },
    data: { departmentId: input.toDepartmentId },
  });
}
