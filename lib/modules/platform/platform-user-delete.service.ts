import { z } from "zod";

import { AccessError, assertFound } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordGlobalPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";

/**
 * Deleting an account that was never used (Admin PRD #8 §42, §46).
 *
 * Removing someone from a group or a company never deletes them; this is the
 * separate, global act. It is for an account made by mistake: one that has
 * never signed in and has left no business history. Anything else is
 * deactivated (suspended) instead, because the account is named by records
 * that must keep their author. The database refuses a delete that would orphan
 * such a record; that refusal rolls the whole transaction back and is
 * answered as "suspend instead", with nothing changed.
 */

export const userDeleteSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  reason: z.string().trim().max(500).optional().transform((value) => value || "Account created by mistake"),
});

export async function deletePlatformUser(context: PlatformContext, raw: unknown): Promise<void> {
  if (!canPlatform(context, "platform.user.manage")) throw new AccessError("FORBIDDEN");
  const input = userDeleteSchema.parse(raw);
  if (input.userId === context.userId) throw new AccessError("CONFLICT", "You cannot delete your own account.", { code: "SELF_DELETE" });
  const user = assertFound(await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, username: true, firstName: true, lastName: true, lastLoginAt: true, platformAccess: { select: { status: true } } } }));
  if (user.platformAccess) throw new AccessError("CONFLICT", "A Platform Admin account cannot be deleted. Remove its platform access first.", { code: "PLATFORM_ACCOUNT" });
  const used = new AccessError("CONFLICT", `${user.firstName} ${user.lastName} has signed in or has records under their name, so the account cannot be deleted. Suspend it instead.`, { code: "ACCOUNT_IN_USE" });
  if (user.lastLoginAt) throw used;

  try {
    await prisma.$transaction(async (tx) => {
      const members = await tx.companyMember.findMany({ where: { userId: user.id }, select: { id: true } });
      const memberIds = members.map((row) => row.id);
      await tx.projectMember.deleteMany({ where: { companyMemberId: { in: memberIds } } });
      await tx.departmentAssignment.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.companyMember.deleteMany({ where: { userId: user.id } });
      await tx.parentGroupMember.deleteMany({ where: { userId: user.id } });
      await tx.user.delete({ where: { id: user.id } });
      await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_USER_DELETED, entity: { type: "User", id: user.id, label: `${user.firstName} ${user.lastName}` }, before: { userId: user.id, username: user.username }, reason: input.reason }, { tx });
    });
  } catch (error) {
    // A foreign-key refusal means a record still names this account.
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "P2003" || code === "P2014") throw used;
    throw error;
  }
}
