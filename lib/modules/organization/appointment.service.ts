import { z } from "zod";

import { GROUP_DEPARTMENTS } from "@/config/group-departments";
import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertPermission } from "@/lib/access/guards";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { clearBranchManager, nameBranchManager } from "@/lib/modules/team/departments/branch-manager";

/**
 * Appointing department heads and company department managers (E-06 §13, §37, §38, §78, §90).
 *
 * The Owner appoints the head of a group department. A company branch's
 * manager is appointed by the Owner, or by the head of that function — for
 * their function only — acting as their membership in that company. A position
 * is held with the role the person already works as: the head of Finance works
 * as Finance, so the position widens Finance and nothing else (§6.5, §121).
 * Ending an appointment keeps it as history. Group IT may see these, not decide
 * them (§37, §40).
 */

export const appointSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  groupDepartmentId: z.string().trim().min(1).max(64),
  /** Absent for a group head; the company whose branch they manage otherwise. */
  branchCompanyId: z.string().trim().min(1).max(64).nullable().optional(),
});
export type AppointInput = z.infer<typeof appointSchema>;

export type AppointmentResultDTO = { assignmentId: string };

function rolesOf(key: string): readonly string[] | null {
  return GROUP_DEPARTMENTS.find((department) => department.key === key)?.roles ?? null;
}

function assertWorksAs(roleKey: string, department: { key: string; name: string }): void {
  const roles = rolesOf(department.key);
  if (roles && !roles.includes(roleKey)) {
    const expected = roles.filter(isMembershipRoleKey).map((role) => roleLabel(role)).join(" or ");
    throw new AccessError("VALIDATION_ERROR", `The ${department.name} department is run by somebody working as ${expected}.`, { field: "userId", code: "ROLE_MISMATCH" });
  }
}

/** The Owner, or the head of this function acting in that company (§37, §78). */
function mayAppointManager(acting: UserContext, groupDepartmentId: string): boolean {
  if (can(acting, "organization.department_manager.assign")) return true;
  return (
    can(acting, "department.company_manager.manage") &&
    acting.assignments.some((assignment) => assignment.positionLevel === "GROUP_HEAD" && assignment.companyId === null && assignment.groupDepartmentId === groupDepartmentId)
  );
}

export async function appoint(context: UserContext, input: AppointInput): Promise<AppointmentResultDTO> {
  const department = assertFound(
    await prisma.groupDepartment.findFirst({ where: { id: input.groupDepartmentId, parentGroupId: context.parentGroupId, status: "ACTIVE" }, select: { id: true, key: true, name: true } }),
  );

  if (!input.branchCompanyId) {
    assertPermission(context, "organization.department_head.assign");
    const memberships = await prisma.companyMember.findMany({
      where: { userId: input.userId, status: "ACTIVE", company: { parentGroupId: context.parentGroupId, status: "ACTIVE" } },
      select: { companyId: true, role: { select: { key: true } }, user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (memberships.length === 0) throw new AccessError("VALIDATION_ERROR", "Appoint somebody who works in the group.", { field: "userId" });
    const roleKey = (memberships.find((membership) => membership.companyId === context.companyId) ?? memberships[0]).role.key;
    assertWorksAs(roleKey, department);
    const name = `${memberships[0].user.firstName} ${memberships[0].user.lastName}`;

    const assignmentId = await prisma.$transaction(async (tx) => {
      const existing = await tx.departmentAssignment.count({ where: { userId: input.userId, groupDepartmentId: department.id, positionLevel: "GROUP_HEAD", companyId: null, status: "ACTIVE" } });
      if (existing > 0) throw new AccessError("CONFLICT", `${name} already heads ${department.name}.`);
      const assignment = await tx.departmentAssignment.create({
        data: { parentGroupId: context.parentGroupId, userId: input.userId, groupDepartmentId: department.id, companyId: null, companyDepartmentId: null, functionalRoleKey: roleKey, positionLevel: "GROUP_HEAD", accessLevel: "MANAGE", status: "ACTIVE", startsAt: new Date(), createdByUserId: context.userId },
        select: { id: true },
      });
      await recordUserAction(
        context,
        { actionKey: AuditAction.ORGANIZATION_GROUP_DEPARTMENT_HEAD_ASSIGNED, entity: { type: "DepartmentAssignment", id: assignment.id, label: `${name} — ${department.name}` }, after: { userId: input.userId, groupDepartmentId: department.id, functionalRoleKey: roleKey, positionLevel: "GROUP_HEAD" } },
        { tx },
      );
      return assignment.id;
    });
    return { assignmentId };
  }

  const acting = await contextInCompany(context, input.branchCompanyId);
  if (!acting) throw new AccessError("NOT_FOUND");
  if (!mayAppointManager(acting, department.id)) throw new AccessError("FORBIDDEN");

  const [branch, member] = await Promise.all([
    prisma.department.findFirst({ where: { companyId: input.branchCompanyId, groupDepartmentId: department.id, status: "ACTIVE" }, select: { id: true } }),
    prisma.companyMember.findFirst({
      where: { userId: input.userId, companyId: input.branchCompanyId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { id: true, role: { select: { key: true } }, user: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  if (!branch) throw new AccessError("VALIDATION_ERROR", `That company has no ${department.name} branch.`, { field: "companyId" });
  if (!member) throw new AccessError("VALIDATION_ERROR", "Appoint somebody who works in that company.", { field: "userId" });
  assertWorksAs(member.role.key, department);
  const name = `${member.user.firstName} ${member.user.lastName}`;

  const assignmentId = await prisma.$transaction(async (tx) => {
    const existing = await tx.departmentAssignment.count({ where: { userId: input.userId, companyDepartmentId: branch.id, positionLevel: "COMPANY_MANAGER", status: "ACTIVE" } });
    if (existing > 0) throw new AccessError("CONFLICT", `${name} already manages this branch.`);
    const assignment = await tx.departmentAssignment.create({
      data: { parentGroupId: context.parentGroupId, userId: input.userId, groupDepartmentId: department.id, companyId: input.branchCompanyId!, companyDepartmentId: branch.id, functionalRoleKey: member.role.key, positionLevel: "COMPANY_MANAGER", accessLevel: "APPROVE", status: "ACTIVE", startsAt: new Date(), createdByUserId: context.userId },
      select: { id: true },
    });
    await nameBranchManager(tx, { departmentId: branch.id, companyId: input.branchCompanyId!, memberId: member.id });
    await recordUserAction(
      acting,
      { actionKey: AuditAction.ORGANIZATION_COMPANY_DEPARTMENT_MANAGER_ASSIGNED, entity: { type: "DepartmentAssignment", id: assignment.id, label: `${name} — ${department.name}` }, after: { userId: input.userId, groupDepartmentId: department.id, companyId: input.branchCompanyId, companyDepartmentId: branch.id, functionalRoleKey: member.role.key, positionLevel: "COMPANY_MANAGER" } },
      { tx },
    );
    return assignment.id;
  });
  return { assignmentId };
}

export async function endAppointment(context: UserContext, assignmentId: string): Promise<void> {
  const assignment = assertFound(
    await prisma.departmentAssignment.findFirst({
      where: { id: assignmentId, parentGroupId: context.parentGroupId, status: "ACTIVE", positionLevel: { in: ["GROUP_HEAD", "COMPANY_MANAGER"] } },
      select: { id: true, userId: true, positionLevel: true, groupDepartmentId: true, companyId: true, companyDepartmentId: true, user: { select: { firstName: true, lastName: true } }, groupDepartment: { select: { name: true } } },
    }),
  );

  let acting = context;
  if (assignment.positionLevel === "GROUP_HEAD") {
    assertPermission(context, "organization.department_head.assign");
  } else {
    const inCompany = await contextInCompany(context, assignment.companyId!);
    if (!inCompany) throw new AccessError("NOT_FOUND");
    if (!mayAppointManager(inCompany, assignment.groupDepartmentId)) throw new AccessError("FORBIDDEN");
    acting = inCompany;
  }

  const label = `${assignment.user.firstName} ${assignment.user.lastName} — ${assignment.groupDepartment.name}`;
  await prisma.$transaction(async (tx) => {
    const ended = await tx.departmentAssignment.updateMany({
      where: { id: assignment.id, status: "ACTIVE" },
      data: { status: "INACTIVE", endsAt: new Date(), endedByUserId: context.userId },
    });
    if (ended.count === 0) throw new AccessError("CONFLICT", "This appointment has already ended.");
    if (assignment.positionLevel === "COMPANY_MANAGER" && assignment.companyDepartmentId) {
      const member = await tx.companyMember.findFirst({ where: { userId: assignment.userId, companyId: assignment.companyId! }, select: { id: true } });
      if (member) await clearBranchManager(tx, { departmentId: assignment.companyDepartmentId, companyId: assignment.companyId!, memberId: member.id });
    }
    await recordUserAction(
      acting,
      { actionKey: AuditAction.ORGANIZATION_DEPARTMENT_ASSIGNMENT_ENDED, entity: { type: "DepartmentAssignment", id: assignment.id, label }, before: { userId: assignment.userId, groupDepartmentId: assignment.groupDepartmentId, companyId: assignment.companyId, positionLevel: assignment.positionLevel } },
      { tx },
    );
  });
}
