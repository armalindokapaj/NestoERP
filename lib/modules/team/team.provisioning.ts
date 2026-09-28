import type { Prisma } from "@prisma/client";

import { assertWithinLimit } from "@/lib/modules/entitlements/entitlement.service";
import { AccessError } from "@/lib/access/guards";

/**
 * The membership an approved account request creates (E-06 §28, §93).
 *
 * Team's door for Group IT: the person joins the company active, with the
 * role, department and job title HR's request carries, in the provisioning
 * transaction. Somebody who already belongs to the company is refused rather
 * than given a second membership — one person, one membership per company
 * (§83).
 */
export async function createProvisionedMembership(
  tx: Prisma.TransactionClient,
  input: { companyId: string; userId: string; roleId: string; departmentId: string; jobTitle: string | null },
): Promise<{ id: string }> {
  const existing = await tx.companyMember.findUnique({
    where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
    select: { id: true },
  });
  if (existing) {
    throw new AccessError("CONFLICT", "This person already has a membership in that company.", { code: "MEMBERSHIP_EXISTS" });
  }
  // The company's contracted active-user limit (Admin Modules PRD #4 §49).
  await assertWithinLimit(tx, input.companyId, "users");
  return tx.companyMember.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      roleId: input.roleId,
      departmentId: input.departmentId,
      jobTitle: input.jobTitle,
      status: "ACTIVE",
      joinedAt: new Date(),
    },
    select: { id: true },
  });
}
