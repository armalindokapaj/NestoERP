import type { ParentGroupStatus, Prisma } from "@prisma/client";

import { rolesOfFunction } from "@/config/group-departments";
import type { PlatformPermission } from "@/config/platform";
import type { Permission } from "@/config/permissions";
import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { can } from "@/lib/access/can";
import { AccessError, assertFound } from "@/lib/access/guards";
import { contextInCompany } from "@/lib/context/member-context";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import type { UserContext } from "@/lib/context/types";
import type { RecordAuditInput } from "@/lib/core/audit/audit.types";
import { auditContextFromUser, recordAuditEvent, recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";

/**
 * Who is changing the group's departments, and whether they may (E-13 §50-§57,
 * §94, §111).
 *
 * Organization and the Platform Admin call the same services on the same
 * records (§51); only this differs. A member acts through the permissions of
 * their membership — in a company, through their membership *there*
 * (`contextInCompany`), so a sibling company's department is decided by what
 * they hold in it, and audited in it. The Platform Admin acts through platform
 * permissions, only while the group is being implemented, and is audited as the
 * platform (§111; E-06 §116, §138).
 */

export type DepartmentActor =
  | { kind: "member"; context: UserContext }
  | { kind: "platform"; context: PlatformContext; parentGroupId: string };

export const memberActor = (context: UserContext): DepartmentActor => ({ kind: "member", context });
export const platformActor = (context: PlatformContext, parentGroupId: string): DepartmentActor => ({ kind: "platform", context, parentGroupId });

export function groupOf(actor: DepartmentActor): string {
  return actor.kind === "member" ? actor.context.parentGroupId : actor.parentGroupId;
}

export function actorUserId(actor: DepartmentActor): string {
  return actor.context.userId;
}

const IMPLEMENTING: ParentGroupStatus[] = ["IMPLEMENTING", "READY_FOR_VALIDATION", "ACTIVE"];

/** The platform's department tools close when the group goes live (E-13 §94; E-06 §138). */
async function assertPlatform(actor: Extract<DepartmentActor, { kind: "platform" }>, permission: PlatformPermission): Promise<void> {
  if (!canPlatform(actor.context, permission)) throw new AccessError("FORBIDDEN");
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: actor.parentGroupId, isTestFixture: false }, select: { status: true } }));
  if (!IMPLEMENTING.includes(group.status)) {
    throw new AccessError("CONFLICT", "The group is live: its Owner and Group IT keep its departments now.", { code: "IMPLEMENTATION_CLOSED" });
  }
}

/**
 * The membership a member acts through in one company of their group. Not
 * working there is "not found", the way any record out of reach is (E-06 §117).
 */
async function actingIn(context: UserContext, companyId: string): Promise<UserContext> {
  if (companyId === context.companyId) return context;
  const acting = await contextInCompany(context, companyId);
  if (!acting) throw new AccessError("NOT_FOUND");
  return acting;
}

/** Whether this context heads the function, or manages the branch, it acts on. */
export function holdsPosition(context: UserContext, groupDepartmentId: string, branchId: string | null): boolean {
  return context.assignments.some(
    (assignment) =>
      (assignment.positionLevel === "GROUP_HEAD" && assignment.companyId === null && assignment.groupDepartmentId === groupDepartmentId) ||
      (branchId !== null && assignment.positionLevel === "COMPANY_MANAGER" && assignment.companyDepartmentId === branchId),
  );
}

/**
 * Configuring the departments: creating, editing, deactivating one, and
 * activating it in a company (§53). The Owner and Group IT.
 * Returns the membership to audit through, or null for the platform.
 */
export async function authorizeConfiguration(actor: DepartmentActor, companyId?: string): Promise<UserContext | null> {
  if (actor.kind === "platform") {
    await assertPlatform(actor, "platform.group.configure");
    return null;
  }
  const acting = companyId ? await actingIn(actor.context, companyId) : actor.context;
  if (!can(acting, "organization.department.manage")) throw new AccessError("FORBIDDEN");
  return acting;
}

/** Appointing a group department's head (§13; E-06 §37): the Owner. */
export async function authorizeHead(actor: DepartmentActor): Promise<UserContext | null> {
  if (actor.kind === "platform") {
    await assertPlatform(actor, "platform.user.initial_provision");
    return null;
  }
  if (!can(actor.context, "organization.department_head.assign")) throw new AccessError("FORBIDDEN");
  return actor.context;
}

/** Appointing a branch's manager: the Owner, or that function's head acting in the company (§54; E-06 §38). */
export async function authorizeManager(actor: DepartmentActor, groupDepartmentId: string, companyId: string): Promise<UserContext | null> {
  if (actor.kind === "platform") {
    await assertPlatform(actor, "platform.user.initial_provision");
    return null;
  }
  const acting = await actingIn(actor.context, companyId);
  if (!mayAppointManagerIn(acting, groupDepartmentId)) throw new AccessError("FORBIDDEN");
  return acting;
}

/**
 * Staffing a branch (§13, §55, §85): the Owner anywhere; the branch's manager
 * or the function's head, acting in that company, for that branch only.
 */
export async function authorizeMembers(actor: DepartmentActor, groupDepartmentId: string, branch: { id: string; companyId: string }, action: "assign" | "remove"): Promise<UserContext | null> {
  if (actor.kind === "platform") {
    await assertPlatform(actor, "platform.user.initial_provision");
    return null;
  }
  const acting = await actingIn(actor.context, branch.companyId);
  const permission: Permission = action === "assign" ? "department.member.assign" : "department.member.remove";
  const allowed = can(acting, "organization.department.member.manage") || (can(acting, permission) && holdsPosition(acting, groupDepartmentId, branch.id));
  if (!allowed) throw new AccessError("FORBIDDEN");
  return acting;
}

/** Whether a member context may staff a branch — for capabilities; the service asks again. */
export function mayStaff(acting: UserContext, groupDepartmentId: string, branchId: string): boolean {
  return can(acting, "organization.department.member.manage") || (can(acting, "department.member.assign") && holdsPosition(acting, groupDepartmentId, branchId));
}

export function mayAppointManagerIn(acting: UserContext, groupDepartmentId: string): boolean {
  return (
    can(acting, "organization.department_manager.assign") ||
    (can(acting, "department.company_manager.manage") && acting.assignments.some((row) => row.positionLevel === "GROUP_HEAD" && row.companyId === null && row.groupDepartmentId === groupDepartmentId))
  );
}

/**
 * The audit record of a department change (§91, §92), inside the change's
 * transaction. A member's is written in the company they acted in, and placed
 * in the group; the platform's belongs to the group alone.
 */
export async function auditDepartment(tx: Prisma.TransactionClient, actor: DepartmentActor, acting: UserContext | null, input: RecordAuditInput): Promise<void> {
  if (actor.kind === "platform") {
    await recordPlatformAction(actor.context, actor.parentGroupId, input, { tx });
    return;
  }
  const context = acting ?? actor.context;
  await recordAuditEvent({ ...auditContextFromUser(context), parentGroupId: context.parentGroupId }, input, { tx });
}

/**
 * A position is held with the role the person works as (E-06 §6.5): a
 * function's positions go to people working as one of its roles. A department
 * the group added binds none, so anybody may hold its positions — which widen
 * nothing (ADR 0003).
 */
export function assertWorksAs(roleKey: string, department: { key: string; name: string }): void {
  const roles = rolesOfFunction(department.key) as readonly string[];
  if (roles.length > 0 && !roles.includes(roleKey)) {
    const expected = roles.filter(isMembershipRoleKey).map((role) => roleLabel(role)).join(" or ");
    throw new AccessError("VALIDATION_ERROR", `The ${department.name} department is run by somebody working as ${expected}.`, { field: "personId", code: "ROLE_MISMATCH" });
  }
}
