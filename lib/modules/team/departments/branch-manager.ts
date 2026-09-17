import type { Prisma } from "@prisma/client";

/**
 * Team's door for a department appointment (E-06 §13, §37).
 *
 * A company branch names its manager, as the Team module always has; the
 * position itself is the organization's department assignment. Appointing a
 * manager names them on the branch; ending the appointment clears the name only
 * if it is still theirs, so a later appointment is never undone by an earlier
 * one ending.
 */
export async function nameBranchManager(tx: Prisma.TransactionClient, input: { departmentId: string; companyId: string; memberId: string }): Promise<void> {
  await tx.department.updateMany({ where: { id: input.departmentId, companyId: input.companyId }, data: { managerMemberId: input.memberId } });
}

export async function clearBranchManager(tx: Prisma.TransactionClient, input: { departmentId: string; companyId: string; memberId: string }): Promise<void> {
  await tx.department.updateMany({ where: { id: input.departmentId, companyId: input.companyId, managerMemberId: input.memberId }, data: { managerMemberId: null } });
}
