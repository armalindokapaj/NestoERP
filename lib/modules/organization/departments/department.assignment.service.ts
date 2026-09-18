import { Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { prisma } from "@/lib/database/prisma";
import { clearBranchManager, moveHome, nameBranchManager, placeHomeIfUnplaced } from "@/lib/modules/team/departments/branch.doors";

import { actorUserId, assertWorksAs, auditDepartment, authorizeHead, authorizeManager, authorizeMembers, groupOf, type DepartmentActor } from "./department.actor";
import { assertOpen, loadBranch, loadGroupDepartment, loadPerson, membershipsInGroup, notifyPerson, placeEligibility, type LoadedBranch } from "./department.lookup";
import type { AddMemberInput, AppointPersonInput, UpdateAssignmentInput } from "./department.schema";

/**
 * Who holds a place in the group's departments (E-13 §11-§13, §20-§28, §43-§47,
 * §66, §67, §79, §85, §116-§120, §136, §142).
 *
 * Every place is a `DepartmentAssignment`: one head per group department, one
 * manager per company branch, and a member row per branch somebody works in —
 * several companies, several rows, one person. Replacing a head or a manager
 * ends the old appointment and makes the new one in one transaction, and the
 * database's partial unique indexes refuse a second one that races it. Nothing
 * here creates a person, a login, an employment, a membership or a project
 * place (§45, §83, §119); ending a place keeps it as history (§47, §67).
 */

const ENTITY = "GroupDepartment";

function raced(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AccessError("CONFLICT", "Somebody else changed this at the same moment. Refresh and try again.", { code: "RACED" });
  }
  throw error;
}

const actorMember = (actor: DepartmentActor, acting: UserContext | null) => (actor.kind === "member" ? (acting ?? actor.context).membershipId : null);

async function endRow(tx: Prisma.TransactionClient, id: string, actor: DepartmentActor): Promise<void> {
  const ended = await tx.departmentAssignment.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "INACTIVE", endsAt: new Date(), endedByUserId: actorUserId(actor) } });
  if (ended.count === 0) throw new AccessError("CONFLICT", "That place has already ended.", { code: "ALREADY_ENDED" });
}

/**
 * After somebody leaves a branch, their membership's home in that company
 * follows them: to another branch they still hold a place in there, or nowhere
 * (ADR 0003, the home-branch rule).
 */
async function rehome(tx: Prisma.TransactionClient, input: { userId: string; companyId: string; fromBranchId: string }): Promise<void> {
  const next = await tx.departmentAssignment.findFirst({
    where: { userId: input.userId, companyId: input.companyId, positionLevel: "MEMBER", status: "ACTIVE", companyDepartmentId: { not: input.fromBranchId } },
    select: { companyDepartmentId: true },
    orderBy: { createdAt: "asc" },
  });
  await moveHome(tx, { companyId: input.companyId, userId: input.userId, fromDepartmentId: input.fromBranchId, toDepartmentId: next?.companyDepartmentId ?? null });
}

/* -------------------------------------------------------------------------- */
/* Heads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Appoints a group department's head (E-13 §11, §12, §66, §116). The one in
 * office is replaced only when `replace` says so, and stays as history.
 */
export async function appointGroupHead(actor: DepartmentActor, groupDepartmentId: string, input: AppointPersonInput): Promise<{ assignmentId: string }> {
  const acting = await authorizeHead(actor);
  const parentGroupId = groupOf(actor);
  const department = await loadGroupDepartment(prisma, parentGroupId, groupDepartmentId);
  assertOpen(department);
  const person = await loadPerson(prisma, parentGroupId, input.personId);
  const memberships = await membershipsInGroup(prisma, parentGroupId, person.userId);
  if (memberships.length === 0) throw new AccessError("VALIDATION_ERROR", `${person.name} does not work in any company of the group.`, { field: "personId", code: "NOT_ELIGIBLE" });
  const preferred = actor.kind === "member" ? actor.context.companyId : null;
  const roleKey = (memberships.find((membership) => membership.companyId === preferred) ?? memberships[0]).role.key;
  assertWorksAs(roleKey, department);

  return prisma
    .$transaction(async (tx) => {
      const current = await tx.departmentAssignment.findFirst({
        where: { groupDepartmentId: department.id, positionLevel: "GROUP_HEAD", status: "ACTIVE" },
        select: { id: true, userId: true, user: { select: { firstName: true, lastName: true, personProfileId: true } } },
      });
      const currentName = current ? `${current.user.firstName} ${current.user.lastName}` : null;
      if (current?.userId === person.userId) throw new AccessError("CONFLICT", `${person.name} already heads ${department.name}.`, { code: "ALREADY_HEAD" });
      if (current && !input.replace) {
        throw new AccessError("CONFLICT", `${currentName} heads ${department.name}. Replace them to appoint somebody else.`, { code: "HEAD_EXISTS", holder: currentName });
      }
      if (current) await endRow(tx, current.id, actor);

      const assignment = await tx.departmentAssignment.create({
        data: { parentGroupId, userId: person.userId, groupDepartmentId: department.id, companyId: null, companyDepartmentId: null, functionalRoleKey: roleKey, positionLevel: "GROUP_HEAD", accessLevel: "MANAGE", status: "ACTIVE", startsAt: new Date(), createdByUserId: actorUserId(actor) },
        select: { id: true },
      });
      await auditDepartment(tx, actor, acting, {
        actionKey: current ? AuditAction.ORGANIZATION_GROUP_DEPARTMENT_HEAD_CHANGED : AuditAction.ORGANIZATION_GROUP_DEPARTMENT_HEAD_ASSIGNED,
        entity: { type: ENTITY, id: department.id, label: department.name },
        before: current ? { groupDepartmentId: department.id, assignmentId: current.id, userId: current.userId, personId: current.user.personProfileId, personName: currentName, positionLevel: "GROUP_HEAD" } : undefined,
        after: { groupDepartmentId: department.id, assignmentId: assignment.id, userId: person.userId, personId: person.personId, personName: person.name, functionalRoleKey: roleKey, positionLevel: "GROUP_HEAD" },
      });
      await notifyPerson(tx, { parentGroupId, userId: person.userId, companyId: preferred, groupDepartmentId: department.id, actorMemberId: actorMember(actor, acting), notice: { event: "HEAD" } });
      if (current) {
        await notifyPerson(tx, { parentGroupId, userId: current.userId, companyId: preferred, groupDepartmentId: department.id, actorMemberId: actorMember(actor, acting), notice: { event: "CHANGED", change: `${person.name} now heads ${department.name}.` } });
      }
      return { assignmentId: assignment.id };
    })
    .catch(raced);
}

/* -------------------------------------------------------------------------- */
/* Managers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Appoints a company branch's manager (E-13 §20, §22, §66, §117): somebody who
 * works in that company as one of the function's roles. The one in office is
 * replaced only when `replace` says so, and stays as history; the branch names
 * its new manager through Team's door.
 */
export async function appointCompanyManager(actor: DepartmentActor, branchId: string, input: AppointPersonInput): Promise<{ assignmentId: string }> {
  const parentGroupId = groupOf(actor);
  const branch = await loadBranch(prisma, parentGroupId, branchId);
  const acting = await authorizeManager(actor, branch.groupDepartment.id, branch.companyId);
  assertOpen(branch.groupDepartment, branch);
  const person = await loadPerson(prisma, parentGroupId, input.personId);
  const membership = (await membershipsInGroup(prisma, parentGroupId, person.userId)).find((row) => row.companyId === branch.companyId);
  if (!membership) {
    throw new AccessError("VALIDATION_ERROR", `${person.name} is not eligible for this company: a manager works in it.`, { field: "personId", code: "NOT_ELIGIBLE" });
  }
  assertWorksAs(membership.role.key, branch.groupDepartment);

  return prisma
    .$transaction(async (tx) => {
      const current = await tx.departmentAssignment.findFirst({
        where: { companyDepartmentId: branch.id, positionLevel: "COMPANY_MANAGER", status: "ACTIVE" },
        select: { id: true, userId: true, user: { select: { firstName: true, lastName: true, personProfileId: true } } },
      });
      const currentName = current ? `${current.user.firstName} ${current.user.lastName}` : null;
      if (current?.userId === person.userId) throw new AccessError("CONFLICT", `${person.name} already manages ${branch.groupDepartment.name} in ${branch.company.name}.`, { code: "ALREADY_MANAGER" });
      if (current && !input.replace) {
        throw new AccessError("CONFLICT", `${currentName} manages ${branch.groupDepartment.name} in ${branch.company.name}. Replace them to appoint somebody else.`, { code: "MANAGER_EXISTS", holder: currentName });
      }
      if (current) {
        await endRow(tx, current.id, actor);
        const previous = await tx.companyMember.findFirst({ where: { userId: current.userId, companyId: branch.companyId }, select: { id: true } });
        if (previous) await clearBranchManager(tx, { departmentId: branch.id, companyId: branch.companyId, memberId: previous.id });
      }

      const assignment = await tx.departmentAssignment.create({
        data: { parentGroupId, userId: person.userId, groupDepartmentId: branch.groupDepartment.id, companyId: branch.companyId, companyDepartmentId: branch.id, functionalRoleKey: membership.role.key, positionLevel: "COMPANY_MANAGER", accessLevel: "APPROVE", status: "ACTIVE", startsAt: new Date(), createdByUserId: actorUserId(actor) },
        select: { id: true },
      });
      await nameBranchManager(tx, { departmentId: branch.id, companyId: branch.companyId, memberId: membership.id });
      await auditDepartment(tx, actor, acting, {
        actionKey: current ? AuditAction.ORGANIZATION_COMPANY_DEPARTMENT_MANAGER_CHANGED : AuditAction.ORGANIZATION_COMPANY_DEPARTMENT_MANAGER_ASSIGNED,
        entity: { type: ENTITY, id: branch.groupDepartment.id, label: branch.groupDepartment.name },
        before: current ? { groupDepartmentId: branch.groupDepartment.id, companyId: branch.companyId, companyDepartmentId: branch.id, assignmentId: current.id, userId: current.userId, personId: current.user.personProfileId, personName: currentName, positionLevel: "COMPANY_MANAGER" } : undefined,
        after: { groupDepartmentId: branch.groupDepartment.id, companyId: branch.companyId, companyName: branch.company.name, companyDepartmentId: branch.id, assignmentId: assignment.id, userId: person.userId, personId: person.personId, personName: person.name, functionalRoleKey: membership.role.key, positionLevel: "COMPANY_MANAGER" },
      });
      await notifyPerson(tx, { parentGroupId, userId: person.userId, companyId: branch.companyId, groupDepartmentId: branch.groupDepartment.id, actorMemberId: actorMember(actor, acting), notice: { event: "MANAGER", companyName: branch.company.name } });
      if (current) {
        await notifyPerson(tx, { parentGroupId, userId: current.userId, companyId: branch.companyId, groupDepartmentId: branch.groupDepartment.id, actorMemberId: actorMember(actor, acting), notice: { event: "CHANGED", change: `${person.name} now manages ${branch.groupDepartment.name} in ${branch.company.name}.` } });
      }
      return { assignmentId: assignment.id };
    })
    .catch(raced);
}

/* -------------------------------------------------------------------------- */
/* Members                                                                     */
/* -------------------------------------------------------------------------- */

async function createMemberRow(tx: Prisma.TransactionClient, input: { actor: DepartmentActor; parentGroupId: string; branch: LoadedBranch; userId: string; roleKey: string; placeHome: boolean }) {
  const existing = await tx.departmentAssignment.count({ where: { userId: input.userId, companyDepartmentId: input.branch.id, positionLevel: "MEMBER", status: "ACTIVE" } });
  if (existing > 0) throw new AccessError("CONFLICT", `Already in ${input.branch.groupDepartment.name} in ${input.branch.company.name}.`, { code: "ALREADY_MEMBER" });
  const row = await tx.departmentAssignment.create({
    data: { parentGroupId: input.parentGroupId, userId: input.userId, groupDepartmentId: input.branch.groupDepartment.id, companyId: input.branch.companyId, companyDepartmentId: input.branch.id, functionalRoleKey: input.roleKey, positionLevel: "MEMBER", accessLevel: "CONTRIBUTE", status: "ACTIVE", startsAt: new Date(), createdByUserId: actorUserId(input.actor) },
    select: { id: true },
  });
  // Somebody who works in that company and is placed nowhere there yet is placed here.
  if (input.placeHome) await placeHomeIfUnplaced(tx, { companyId: input.branch.companyId, userId: input.userId, departmentId: input.branch.id });
  return row;
}

/**
 * Adds an existing person to a company's branch (E-13 §45, §79, §119, §120):
 * the branch must be open, and they must work in that company or for the whole
 * group. One MEMBER row, nothing else — no login, employment, membership or
 * project place is created, and no module access follows (§59, §60).
 */
export async function addDepartmentMember(actor: DepartmentActor, branchId: string, input: AddMemberInput): Promise<{ assignmentId: string }> {
  const parentGroupId = groupOf(actor);
  const branch = await loadBranch(prisma, parentGroupId, branchId);
  const acting = await authorizeMembers(actor, branch.groupDepartment.id, branch, "assign");
  assertOpen(branch.groupDepartment, branch);
  const person = await loadPerson(prisma, parentGroupId, input.personId);
  const { membership, roleKey } = await placeEligibility(prisma, parentGroupId, person, branch.companyId);

  return prisma
    .$transaction(async (tx) => {
      const row = await createMemberRow(tx, { actor, parentGroupId, branch, userId: person.userId, roleKey, placeHome: membership !== null });
      await auditDepartment(tx, actor, acting, {
        actionKey: AuditAction.ORGANIZATION_DEPARTMENT_MEMBER_ASSIGNED,
        entity: { type: ENTITY, id: branch.groupDepartment.id, label: branch.groupDepartment.name },
        after: { groupDepartmentId: branch.groupDepartment.id, companyId: branch.companyId, companyName: branch.company.name, companyDepartmentId: branch.id, assignmentId: row.id, userId: person.userId, personId: person.personId, personName: person.name, positionLevel: "MEMBER" },
      });
      await notifyPerson(tx, { parentGroupId, userId: person.userId, companyId: branch.companyId, groupDepartmentId: branch.groupDepartment.id, actorMemberId: actorMember(actor, acting), notice: { event: "MEMBER", companyName: branch.company.name } });
      return { assignmentId: row.id };
    })
    .catch(raced);
}

async function loadLiveAssignment(parentGroupId: string, assignmentId: string) {
  return assertFound(
    await prisma.departmentAssignment.findFirst({
      where: { id: assignmentId, parentGroupId, status: "ACTIVE" },
      select: {
        id: true,
        userId: true,
        positionLevel: true,
        groupDepartmentId: true,
        companyId: true,
        companyDepartmentId: true,
        functionalRoleKey: true,
        user: { select: { firstName: true, lastName: true, personProfileId: true } },
        groupDepartment: { select: { id: true, key: true, name: true, status: true } },
        company: { select: { name: true } },
      },
    }),
  );
}

/**
 * Moves a member's place to another company's branch of the same department
 * (E-13 §72, §85): the old place ends and a new one begins, so where they were
 * stays in the history.
 */
export async function moveDepartmentMember(actor: DepartmentActor, assignmentId: string, input: UpdateAssignmentInput): Promise<{ assignmentId: string }> {
  const parentGroupId = groupOf(actor);
  const assignment = await loadLiveAssignment(parentGroupId, assignmentId);
  if (assignment.positionLevel !== "MEMBER" || !assignment.companyDepartmentId || !assignment.companyId) {
    throw new AccessError("VALIDATION_ERROR", "Only a member's place moves. Replace a head or a manager instead.", { code: "NOT_A_MEMBER_PLACE" });
  }
  const from = await loadBranch(prisma, parentGroupId, assignment.companyDepartmentId);
  const to = await loadBranch(prisma, parentGroupId, input.companyDepartmentId);
  if (to.groupDepartment.id !== assignment.groupDepartmentId) throw new AccessError("VALIDATION_ERROR", "Move them within the same department.", { field: "companyDepartmentId" });
  if (to.id === from.id) throw new AccessError("VALIDATION_ERROR", "They are already there.", { field: "companyDepartmentId" });
  const leaving = await authorizeMembers(actor, from.groupDepartment.id, from, "remove");
  const joining = await authorizeMembers(actor, to.groupDepartment.id, to, "assign");
  assertOpen(to.groupDepartment, to);
  const person = await loadPerson(prisma, parentGroupId, assertFound(assignment.user.personProfileId));
  const { membership, roleKey } = await placeEligibility(prisma, parentGroupId, person, to.companyId);

  return prisma
    .$transaction(async (tx) => {
      await endRow(tx, assignment.id, actor);
      await rehome(tx, { userId: assignment.userId, companyId: from.companyId, fromBranchId: from.id });
      const row = await createMemberRow(tx, { actor, parentGroupId, branch: to, userId: assignment.userId, roleKey, placeHome: membership !== null });
      await auditDepartment(tx, actor, joining ?? leaving, {
        actionKey: AuditAction.ORGANIZATION_DEPARTMENT_MEMBER_UPDATED,
        entity: { type: ENTITY, id: to.groupDepartment.id, label: to.groupDepartment.name },
        before: { groupDepartmentId: from.groupDepartment.id, companyId: from.companyId, companyName: from.company.name, companyDepartmentId: from.id, assignmentId: assignment.id, userId: assignment.userId, personId: person.personId, personName: person.name, positionLevel: "MEMBER" },
        after: { groupDepartmentId: to.groupDepartment.id, companyId: to.companyId, companyName: to.company.name, companyDepartmentId: to.id, assignmentId: row.id, userId: assignment.userId, personId: person.personId, personName: person.name, positionLevel: "MEMBER" },
      });
      await notifyPerson(tx, { parentGroupId, userId: assignment.userId, companyId: to.companyId, groupDepartmentId: to.groupDepartment.id, actorMemberId: actorMember(actor, joining ?? leaving), notice: { event: "CHANGED", change: `You moved from ${from.company.name} to ${to.company.name}.`, companyName: to.company.name } });
      return { assignmentId: row.id };
    })
    .catch(raced);
}

/**
 * Ends a place (E-13 §47, §67, §72, §142): a head's or a manager's appointment
 * by those who appoint them, a member's place by those who staff the branch.
 * The row stays as history; the person keeps their job, login, membership and
 * projects. A manager is not taken off the team they manage — end or replace
 * the appointment first.
 */
export async function endDepartmentAssignment(actor: DepartmentActor, assignmentId: string): Promise<void> {
  const parentGroupId = groupOf(actor);
  const assignment = await loadLiveAssignment(parentGroupId, assignmentId);
  const personName = `${assignment.user.firstName} ${assignment.user.lastName}`;
  const department = assignment.groupDepartment;

  let acting: UserContext | null;
  let branch: LoadedBranch | null = null;
  if (assignment.positionLevel === "GROUP_HEAD") {
    acting = await authorizeHead(actor);
  } else if (assignment.positionLevel === "COMPANY_MANAGER") {
    acting = await authorizeManager(actor, department.id, assignment.companyId!);
  } else {
    if (!assignment.companyDepartmentId) throw new AccessError("NOT_FOUND");
    branch = await loadBranch(prisma, parentGroupId, assignment.companyDepartmentId);
    acting = await authorizeMembers(actor, department.id, branch, "remove");
    const manages = await prisma.departmentAssignment.count({ where: { userId: assignment.userId, companyDepartmentId: branch.id, positionLevel: "COMPANY_MANAGER", status: "ACTIVE" } });
    if (manages > 0) {
      throw new AccessError("CONFLICT", `${personName} manages ${department.name} in ${branch.company.name}. End or replace that appointment first.`, { code: "MANAGES_BRANCH" });
    }
  }

  await prisma.$transaction(async (tx) => {
    await endRow(tx, assignment.id, actor);
    if (assignment.positionLevel === "COMPANY_MANAGER" && assignment.companyDepartmentId) {
      const member = await tx.companyMember.findFirst({ where: { userId: assignment.userId, companyId: assignment.companyId! }, select: { id: true } });
      if (member) await clearBranchManager(tx, { departmentId: assignment.companyDepartmentId, companyId: assignment.companyId!, memberId: member.id });
    }
    if (branch) await rehome(tx, { userId: assignment.userId, companyId: branch.companyId, fromBranchId: branch.id });

    const facts = { groupDepartmentId: department.id, companyId: assignment.companyId, companyName: assignment.company?.name ?? null, companyDepartmentId: assignment.companyDepartmentId, assignmentId: assignment.id, userId: assignment.userId, personId: assignment.user.personProfileId, personName, positionLevel: assignment.positionLevel };
    await auditDepartment(tx, actor, acting, {
      actionKey: assignment.positionLevel === "MEMBER" ? AuditAction.ORGANIZATION_DEPARTMENT_MEMBER_REMOVED : AuditAction.ORGANIZATION_DEPARTMENT_ASSIGNMENT_ENDED,
      entity: { type: ENTITY, id: department.id, label: department.name },
      before: { ...facts, status: "ACTIVE" },
      after: { ...facts, status: "INACTIVE" },
    });
    const change =
      assignment.positionLevel === "GROUP_HEAD"
        ? `Your appointment as head of ${department.name} ended.`
        : assignment.positionLevel === "COMPANY_MANAGER"
          ? `Your appointment as manager of ${department.name} in ${assignment.company?.name} ended.`
          : `You are no longer in ${department.name} in ${assignment.company?.name}.`;
    await notifyPerson(tx, { parentGroupId, userId: assignment.userId, companyId: assignment.companyId, groupDepartmentId: department.id, actorMemberId: actorMember(actor, acting), notice: { event: "CHANGED", change } });
  });
}
