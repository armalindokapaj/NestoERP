import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { auditContextFromUser, recordAuditEvent } from "@/lib/core/audit/audit.service";
import type { PlacementDoor } from "@/lib/modules/team/team.placement";

/**
 * Keeps a department's team true to where Team places a membership (E-13
 * §24-§29, ADR 0003): moving somebody's home out of a branch ends their member
 * place there, and into a branch gives them one. Only a branch of one of the
 * group's departments has a team; a department a company made for itself
 * before E-06 has none. A head's or a manager's appointment is not a member
 * place and is left alone.
 */
export const placeMembership: PlacementDoor = async (tx, input) => {
  if (input.fromDepartmentId === input.toDepartmentId) return;
  const ids = [input.fromDepartmentId, input.toDepartmentId].filter((id): id is string => Boolean(id));
  const branches = await tx.department.findMany({
    where: { id: { in: ids }, companyId: input.companyId, groupDepartmentId: { not: null } },
    select: { id: true, groupDepartmentId: true, company: { select: { parentGroupId: true, name: true } }, groupDepartment: { select: { name: true, parentGroupId: true } } },
  });
  const branch = (id: string | null) => branches.find((row) => row.id === id && row.groupDepartment?.parentGroupId === row.company.parentGroupId) ?? null;
  const from = branch(input.fromDepartmentId);
  const to = branch(input.toDepartmentId);
  const now = new Date();

  const audit = async (actionKey: string, groupDepartmentId: string, label: string, facts: Record<string, unknown>) => {
    if (!input.actor) return;
    await recordAuditEvent(
      { ...auditContextFromUser(input.actor), parentGroupId: input.actor.parentGroupId },
      { actionKey, entity: { type: "GroupDepartment", id: groupDepartmentId, label }, ...(actionKey === AuditAction.ORGANIZATION_DEPARTMENT_MEMBER_REMOVED ? { before: { ...facts, status: "ACTIVE" }, after: { ...facts, status: "INACTIVE" } } : { after: facts }) },
      { tx },
    );
  };

  if (from) {
    const place = await tx.departmentAssignment.findFirst({ where: { userId: input.userId, companyDepartmentId: from.id, positionLevel: "MEMBER", status: "ACTIVE" }, select: { id: true } });
    if (place) {
      await tx.departmentAssignment.updateMany({ where: { id: place.id, status: "ACTIVE" }, data: { status: "INACTIVE", endsAt: now, endedByUserId: input.actor?.userId ?? null } });
      await audit(AuditAction.ORGANIZATION_DEPARTMENT_MEMBER_REMOVED, from.groupDepartmentId!, from.groupDepartment!.name, { groupDepartmentId: from.groupDepartmentId, companyId: input.companyId, companyName: from.company.name, companyDepartmentId: from.id, assignmentId: place.id, userId: input.userId, positionLevel: "MEMBER" });
    }
  }

  if (to) {
    const held = await tx.departmentAssignment.count({ where: { userId: input.userId, companyDepartmentId: to.id, positionLevel: "MEMBER", status: "ACTIVE" } });
    // The place is held with the role the membership has there, as it now stands.
    const membership = await tx.companyMember.findFirst({ where: { companyId: input.companyId, userId: input.userId }, select: { role: { select: { key: true } } } });
    if (held === 0 && membership) {
      const place = await tx.departmentAssignment.create({
        data: {
          parentGroupId: to.company.parentGroupId,
          userId: input.userId,
          groupDepartmentId: to.groupDepartmentId!,
          companyId: input.companyId,
          companyDepartmentId: to.id,
          functionalRoleKey: membership.role.key,
          positionLevel: "MEMBER",
          accessLevel: "CONTRIBUTE",
          status: "ACTIVE",
          startsAt: now,
          createdByUserId: input.actor?.userId ?? null,
        },
        select: { id: true },
      });
      await audit(AuditAction.ORGANIZATION_DEPARTMENT_MEMBER_ASSIGNED, to.groupDepartmentId!, to.groupDepartment!.name, { groupDepartmentId: to.groupDepartmentId, companyId: input.companyId, companyName: to.company.name, companyDepartmentId: to.id, assignmentId: place.id, userId: input.userId, positionLevel: "MEMBER" });
    }
  }
};
