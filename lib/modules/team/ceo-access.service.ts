import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { assertMayActOnAccount } from "@/lib/core/security/owner-protection";
import { invalidateRequestScope } from "@/lib/core/observability/request-scope";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import * as repository from "./team.repository";

/**
 * CEO access (2026-11): in a tenant of one company, the CEO gives a member the
 * CEO's rights on top of their own role. The member keeps their role,
 * department and title; the session lays the CEO's rights over them
 * (`buildModuleAccess`'s overlay), and they follow the CEO's if those change.
 *
 * Everyone with the CEO's rights is an equal here: the CEO, an Owner and every
 * holder may give CEO access and take it away (`team.ceo_access.manage`, which
 * the overlay hands on). Nobody takes the CEO's own rights through it — the
 * named CEO holds them by role, which only Change CEO / Remove CEO moves.
 *
 * It is given only while the tenant has one company. A holder keeps it if a
 * second company is added later, and it can still be taken away there.
 */

const MODULE = "team" as const;
const ENTITY = "CompanyMember";

/** Roles that hold the CEO's rights already. */
const CEO_LEVEL_ROLES = ["CEO", "OWNER"];

export async function setCeoAccess(context: UserContext, memberId: string, grant: boolean): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "team.ceo_access.manage");

  const existing = assertFound(await repository.findMemberInScope(context, memberId));
  const name = `${existing.user.firstName} ${existing.user.lastName}`.trim();

  if (existing.groupDerived) {
    throw new AccessError("CONFLICT", "This person's access comes from the group, not from the company. CEO access is for the company's own people.", { code: "CEO_ACCESS_GROUP_DERIVED" });
  }
  if (CEO_LEVEL_ROLES.includes(existing.role.key)) {
    throw new AccessError("CONFLICT", `${name} is ${existing.role.name} and already has the CEO's rights.`, { code: "CEO_ACCESS_NOT_NEEDED" });
  }
  if (grant) {
    if (existing.status !== "ACTIVE") throw new AccessError("CONFLICT", "Only an active member can be given CEO access.", { code: "CEO_ACCESS_INACTIVE" });
    if (existing.ceoAccess) throw new AccessError("CONFLICT", `${name} already has CEO access.`, { code: "CEO_ACCESS_ALREADY" });
    // The session's "one company" may be older than this request; the group is asked again.
    const companies = await prisma.company.count({ where: { parentGroupId: context.parentGroupId } });
    if (companies !== 1) {
      throw new AccessError("CONFLICT", "CEO access is given only in a group with one company.", { code: "CEO_ACCESS_SINGLE_COMPANY_ONLY" });
    }
  } else if (!existing.ceoAccess) {
    throw new AccessError("CONFLICT", `${name} does not have CEO access.`, { code: "CEO_ACCESS_NONE" });
  } else {
    // Taking rights away from a group owner (Owner elsewhere in the group) is an Owner's call (the user, 2026-11-10).
    await assertMayActOnAccount({ actorUserId: context.userId, targetUserId: existing.userId, parentGroupId: context.parentGroupId });
  }

  await runInTransaction("team.member.ceo_access", async (tx) => {
    // The same lock the last-Owner and last-CEO rules take: access changes to one company queue.
    await tx.$queryRaw`SELECT id FROM "companies" WHERE id = ${context.companyId} FOR UPDATE`;

    if (!grant) {
      const others = await tx.companyMember.count({
        where: {
          companyId: context.companyId,
          id: { not: memberId },
          status: "ACTIVE",
          OR: [{ role: { key: { in: CEO_LEVEL_ROLES } } }, { ceoAccess: true, groupDerived: false }],
        },
      });
      if (others === 0) {
        throw new AccessError("CONFLICT", "Someone else must keep the CEO's rights. Give CEO access to another person first.", { code: "CEO_ACCESS_LAST" });
      }
    }

    const now = new Date();
    const updated = await tx.companyMember.updateMany({
      where: { id: memberId, companyId: context.companyId, groupDerived: false, ceoAccess: !grant, ...(grant ? { status: "ACTIVE" as const } : {}) },
      data: {
        ceoAccess: grant,
        ceoAccessGrantedAt: grant ? now : null,
        ceoAccessGrantedByMemberId: grant ? context.membershipId : null,
        accessVersion: { increment: 1 },
      },
    });
    if (!updated.count) {
      throw new AccessError("CONFLICT", "This member was updated by another user. Refresh and review the latest changes.", { code: "CEO_ACCESS_STALE" });
    }

    if (grant) {
      await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: memberId, action: "MEMBER_CEO_ACCESS_GRANTED", message: "gave them CEO access", metadata: { memberId } });
    } else {
      await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: memberId, action: "MEMBER_CEO_ACCESS_REMOVED", message: "removed their CEO access", metadata: { memberId } });
    }
    // Access control's evidence commits with the change, or neither happens (PRD #28 §95).
    await recordUserAction(
      context,
      {
        actionKey: grant ? AuditAction.TEAM_MEMBER_CEO_ACCESS_GRANTED : AuditAction.TEAM_MEMBER_CEO_ACCESS_REMOVED,
        entity: { type: ENTITY, id: memberId, label: name },
        before: { ceoAccess: !grant, roleKey: existing.role.key },
        after: { ceoAccess: grant, roleKey: existing.role.key },
      },
      { tx },
    );
  });

  // What this member may do changed: nothing later in this request answers from before it.
  invalidateRequestScope();
}
