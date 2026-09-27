import { Prisma, type WorkerCategory } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { dayOf, todayDay } from "../employment/employment.dates";
import { openAssignment, startHistory, syncCache } from "../employment/employment.history";
import { employmentCapabilities } from "../employment/employment.capabilities";
import { validateDepartment, validateManager } from "../employment/employment.validate";
import { businessDateString, toBusinessDate } from "../hr.date";
import { buildHrMemberScopeWhere, isSelf } from "../hr.scope";
import { accountStatusOf, personForMember } from "../hr.person";
import type {
  CreateEmployeeProfileInput,
  EmployeeListQuery,
  UpdateEmployeeProfileInput,
} from "../hr.schema";
import type { EmployeeDetailDTO, EmployeeSummaryDTO } from "../hr.types";
import * as repository from "./employee.repository";

/**
 * Employment records (PRD #16 §25–§57; E-04 §2-§8, §14, §156, §229).
 *
 * An employee is their employment, addressed by its id. A login is optional:
 * a construction worker, a driver, a labourer is employed, paid, placed and
 * recorded without ever signing in, and gets the same record as anybody else
 * (E-04 §1, §4). When they later need NESTO, Group IT links a login to this
 * same employment — never a second one (§5, §88).
 *
 * Where somebody sits — department, title, manager, location, type — and their
 * status are not edited here: each is a dated change in the employment's
 * history, made through `employment/employment.change.service.ts` (E-03 §7,
 * §37, §187). This service creates the record and edits what is not history.
 *
 * Three rules live here and nowhere else:
 *
 *   1. **Employment is not access.** Ending somebody's employment does not
 *      deactivate their membership, and deactivating a membership does not end
 *      their employment. Both are deliberate, separate decisions — HR records
 *      what happened, Team decides who can sign in (PRD #16 §29, §230, §231).
 *   2. **Pay is never part of an employee DTO.** Compensation has its own
 *      service and its own permission; `hr.employee.view` tells you somebody
 *      works here and nothing about what they earn (PRD #16 §15, §17).
 *   3. **Nobody manages themselves.** A manager loop would make the department
 *      approval chain infinite (PRD #16 §32).
 */

const MODULE = "hr" as const;
const ENTITY = "EmployeeProfile";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listEmployees(context: UserContext, query: EmployeeListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employee.view");

  const { rows, window } = await repository.listEmployees(context, query);

  return {
    data: rows.map(toSummaryDTO),
    pagination: window,
  };
}

/**
 * One employment record, addressed by its id (E-04 §14).
 *
 * Self-service is the second door: somebody with no HR permission at all still
 * reaches their own record through `hr.self.employment` (PRD #16 §16).
 */
export async function getEmployee(
  context: UserContext,
  employmentId: string,
): Promise<EmployeeDetailDTO> {
  assertModule(context, MODULE);
  if (!can(context, "hr.employee.view") && !can(context, "hr.self.employment")) {
    assertPermission(context, "hr.employee.view");
  }

  // Out of scope answers "not found", so the response cannot confirm that
  // somebody works here to a reader who may not see them (PRD #16 §202).
  const profile = assertFound(await repository.findEmployee(context, employmentId));
  if (!can(context, "hr.employee.view") && !isSelf(context, profile.companyMemberId)) {
    throw new AccessError("NOT_FOUND");
  }
  const [guards, current] = await Promise.all([employmentGuards(context, profile.id, profile.companyMemberId), openAssignment(prisma, profile.id)]);

  return toDetailDTO(context, profile, guards, current?.id ?? null);
}

/**
 * The employment a login holds here, when this reader may open it — for the
 * Team cross-link, and for links written before employments were the address.
 */
export async function employmentIdForMember(context: UserContext, memberId: string): Promise<string | null> {
  if (!can(context, "hr.employee.view") && !(isSelf(context, memberId) && can(context, "hr.self.employment"))) return null;
  return repository.findEmploymentIdForMember(context, memberId);
}

/** Whether a profile exists for this member at all, for the Team cross-link. */
export async function hasEmployeeProfile(
  context: UserContext,
  memberId: string,
): Promise<boolean> {
  return (await employmentIdForMember(context, memberId)) !== null;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

type Subject =
  | { kind: "MEMBER"; memberId: string; userId: string; jobTitle: string | null; departmentId: string | null; name: string }
  | { kind: "PERSON"; personId: string; name: string }
  | { kind: "NEW"; firstName: string; lastName: string; name: string };

/** A person the new one might be (E-04 §92, §176): shown to HR, never a reason to refuse outright. */
export type ProbableDuplicate = { personId: string; name: string; companies: string[]; reasons: string[] };

/**
 * A new employment (PRD #16 §25, E-04 §229): for somebody with a login here,
 * for a person the group already knows, or for somebody new who has neither.
 * It starts PLANNED; starting it is a dated change of its own (§101, §103).
 */
export async function createEmployeeProfile(
  context: UserContext,
  input: CreateEmployeeProfileInput,
): Promise<EmployeeDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employee.create_profile");
  if (input.managerMemberId) assertPermission(context, "hr.employee.manager.assign");

  const subject = await resolveSubject(context, input);
  if (subject.kind === "NEW" && !input.confirmNewPerson) {
    const duplicates = await probableDuplicates(context, input);
    if (duplicates.length > 0) {
      throw new AccessError("CONFLICT", "Somebody in the group may already be this person. Choose them, or confirm this is somebody new.", {
        code: "PROBABLE_DUPLICATE",
        candidates: duplicates,
      });
    }
  }

  const employmentId = await prisma.$transaction(async (tx) => {
    if (subject.kind === "MEMBER") {
      const existing = await tx.employeeProfile.findUnique({ where: { companyMemberId: subject.memberId }, select: { id: true } });
      if (existing) throw new AccessError("CONFLICT", "That person already has an employment record.", { code: "HAS_EMPLOYMENT" });
    }
    if (subject.kind === "PERSON") {
      const here = await tx.employeeProfile.findFirst({
        where: { companyId: context.companyId, personProfileId: subject.personId },
        select: { employmentStatus: true },
      });
      if (here) {
        throw new AccessError(
          "CONFLICT",
          here.employmentStatus === "ENDED"
            ? `${subject.name} was employed here before. Rehire them, so the same record carries on (E-03).`
            : `${subject.name} is already employed here.`,
          { code: "HAS_EMPLOYMENT" },
        );
      }
    }

    if (input.employeeNumber) await assertNumberIsFree(tx, context, input.employeeNumber, null);
    const manager = input.managerMemberId
      ? await validateManager(tx, { companyId: context.companyId, managerMemberId: input.managerMemberId, subjectMemberId: subject.kind === "MEMBER" ? subject.memberId : null })
      : null;
    // A member's department and title are the membership's (E-03 decision 7);
    // anybody else's are chosen here.
    const departmentId = subject.kind === "MEMBER"
      ? subject.departmentId
      : input.departmentId
        ? (await validateDepartment(tx, context.companyId, input.departmentId)).id
        : null;
    const jobTitle = subject.kind === "MEMBER" ? subject.jobTitle : (input.jobTitle ?? null);
    const tradeId = input.tradeId ? (await validateTrade(tx, context.companyId, input.tradeId)).id : null;

    const personProfileId = await personFor(tx, context, subject, input, jobTitle);
    const employment = await tx.employeeProfile.create({
      data: {
        companyId: context.companyId,
        personProfileId,
        companyMemberId: subject.kind === "MEMBER" ? subject.memberId : null,
        employeeNumber: input.employeeNumber ?? null,
        // A profile always starts PLANNED. Making somebody active is its own
        // action, so the date it happened is recorded (PRD #16 §38, §54).
        employmentStatus: "PLANNED",
        employmentType: input.employmentType,
        workerCategory: input.workerCategory ?? null,
        tradeId,
        probationEndDate: input.probationEndDate ? toBusinessDate(input.probationEndDate) : null,
        endDate: input.endDate ? toBusinessDate(input.endDate) : null,
        weeklyHours: input.weeklyHours ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });
    // Where they will sit is the history's first row (E-03 §8, §183).
    await startHistory(tx, {
      employmentId: employment.id,
      companyId: context.companyId,
      placement: {
        departmentId,
        jobTitle,
        managerMemberId: manager?.id ?? null,
        workLocationType: input.workLocationType ?? null,
        workLocation: input.workLocation ?? null,
        employmentType: input.employmentType,
      },
      start: input.startDate ? dayOf(toBusinessDate(input.startDate)) : todayDay(),
      status: "PLANNED",
      statusFrom: todayDay(),
      assignmentReason: "HIRE",
      statusReason: "HIRE",
      source: "CHANGE",
      actorUserId: context.userId,
    });
    await syncCache(tx, { id: employment.id, companyId: context.companyId }, { actorMemberId: context.membershipId });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: employment.id,
      action: "HR_EMPLOYEE_PROFILE_CREATED",
      message: `created an employment record for ${subject.name}`,
      metadata: {
        employmentId: employment.id,
        memberId: subject.kind === "MEMBER" ? subject.memberId : null,
        employmentType: input.employmentType,
        account: subject.kind === "MEMBER" ? "HAS_ACCOUNT" : "NO_ACCOUNT",
      } as Prisma.InputJsonValue,
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.HR_EMPLOYEE_CREATED,
        entity: { type: ENTITY, id: employment.id, label: subject.name },
        after: { employmentStatus: "PLANNED", personProfileId, departmentId },
      },
      { tx },
    );

    return employment.id;
  });

  return getEmployee(context, employmentId);
}

/**
 * The details of an employment that are not history (E-03 §37, §187; E-04
 * §156): its number, probation end, planned end, weekly hours, and what kind
 * of worker and which trade.
 */
export async function updateEmployeeProfile(
  context: UserContext,
  employmentId: string,
  input: UpdateEmployeeProfileInput,
): Promise<EmployeeDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employment.update");

  const existing = assertFound(await repository.findEmployee(context, employmentId));

  // Ended employment is history: it reopens through a rehire, and the record
  // page offers no edit for it (PRD #16 §56, PRD #47 §85).
  if (existing.employmentStatus === "ENDED") {
    throw stateDenied("Ended employment is not edited. Rehire to reopen it.");
  }

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This record was updated by another user. Refresh and review the latest changes.",
    );
  }
  if (input.endDate && existing.startDate && input.endDate.getTime() < existing.startDate.getTime()) {
    throw new AccessError("VALIDATION_ERROR", "The end date cannot be before the start date.", { field: "endDate" });
  }
  // The same rule as on create, against the start that is stored (AUD-09 §4, FV-07).
  if (input.probationEndDate && existing.startDate && input.probationEndDate.getTime() < existing.startDate.getTime()) {
    throw new AccessError("VALIDATION_ERROR", "Probation cannot end before the employment starts.", { field: "probationEndDate", code: "PROBATION_BEFORE_START" });
  }

  // Absent is unchanged; null is cleared (AUD-09 §4, FV-05): a PATCH naming
  // one field, or a form that did not render another, erases nothing else.
  const employeeNumber = input.employeeNumber === undefined ? existing.employeeNumber : input.employeeNumber;

  await prisma.$transaction(async (tx) => {
    if (input.employeeNumber) {
      await assertNumberIsFree(tx, context, input.employeeNumber, existing.id);
    }
    const tradeId = input.tradeId === undefined ? undefined : input.tradeId === null ? null : (await validateTrade(tx, context.companyId, input.tradeId)).id;
    const workerCategory: WorkerCategory | null | undefined = input.workerCategory;

    // Conditional on the status that was read, so employment ended a moment
    // ago is not rewritten by an edit that started before it.
    const written = await tx.employeeProfile.updateMany({
      where: { id: existing.id, companyId: context.companyId, employmentStatus: existing.employmentStatus },
      data: {
        ...(input.employeeNumber !== undefined ? { employeeNumber: input.employeeNumber } : {}),
        ...(input.probationEndDate !== undefined ? { probationEndDate: input.probationEndDate ? toBusinessDate(input.probationEndDate) : null } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate ? toBusinessDate(input.endDate) : null } : {}),
        ...(input.weeklyHours !== undefined ? { weeklyHours: input.weeklyHours } : {}),
        ...(workerCategory !== undefined ? { workerCategory } : {}),
        ...(tradeId !== undefined ? { tradeId } : {}),
        updatedByMemberId: context.membershipId,
      },
    });
    if (written.count === 0) {
      throw stateDenied("This record changed while you were working on it. Refresh and review it.");
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.id,
      action: "HR_EMPLOYEE_PROFILE_UPDATED",
      message: "updated their employment record",
      metadata: { employmentId: existing.id, memberId: existing.companyMemberId } as Prisma.InputJsonValue,
    });
    const categoryChanged = workerCategory !== undefined && workerCategory !== existing.workerCategory;
    const tradeChanged = tradeId !== undefined && tradeId !== (existing.trade?.id ?? null);
    if (categoryChanged || tradeChanged || employeeNumber !== existing.employeeNumber) {
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.HR_EMPLOYEE_UPDATED,
          entity: { type: ENTITY, id: existing.id, label: personLabel(existing) },
          before: { employeeNumber: existing.employeeNumber, workerCategory: existing.workerCategory, tradeId: existing.trade?.id ?? null },
          after: {
            employeeNumber,
            workerCategory: workerCategory === undefined ? existing.workerCategory : workerCategory,
            tradeId: tradeId === undefined ? (existing.trade?.id ?? null) : tradeId,
          },
        },
        { tx },
      );
    }
  });

  return getEmployee(context, employmentId);
}

/** Onboarding and offboarding progress (PRD #16 §117, §121, §123). */
export async function setProgress(
  context: UserContext,
  employmentId: string,
  kind: "onboarding" | "offboarding",
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED",
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(
    context,
    kind === "onboarding" ? "hr.onboarding.manage" : "hr.offboarding.manage",
  );

  const existing = assertFound(await repository.findEmployee(context, employmentId));

  await prisma.$transaction(async (tx) => {
    await tx.employeeProfile.update({
      where: { id: existing.id, companyId: context.companyId },
      data: {
        ...(kind === "onboarding"
          ? { onboardingStatus: status }
          : { offboardingStatus: status }),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: existing.id,
      action: kind === "onboarding" ? "HR_ONBOARDING_UPDATED" : "HR_OFFBOARDING_UPDATED",
      message:
        kind === "onboarding"
          ? `set onboarding to ${status.toLowerCase().replace("_", " ")}`
          : `set offboarding to ${status.toLowerCase().replace("_", " ")}`,
      metadata: { employmentId: existing.id, memberId: existing.companyMemberId, status } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function resolveSubject(context: UserContext, input: CreateEmployeeProfileInput): Promise<Subject> {
  switch (input.subject) {
    case "MEMBER": {
      const member = await prisma.companyMember.findFirst({
        where: { AND: [buildHrMemberScopeWhere(context), { id: input.companyMemberId ?? "" }] },
        select: { id: true, userId: true, jobTitle: true, departmentId: true, user: { select: { firstName: true, lastName: true } } },
      });
      if (!member) throw new AccessError("VALIDATION_ERROR", "That team member does not exist.", { field: "companyMemberId" });
      return { kind: "MEMBER", memberId: member.id, userId: member.userId, jobTitle: member.jobTitle, departmentId: member.departmentId, name: `${member.user.firstName} ${member.user.lastName}` };
    }
    case "PERSON": {
      // A person of this group only; another group's is not found (E-04 §170, §215).
      const person = await prisma.personProfile.findFirst({
        where: { id: input.personProfileId ?? "", parentGroupId: context.parentGroupId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!person) throw new AccessError("VALIDATION_ERROR", "That person is not one of this group's.", { field: "personProfileId" });
      return { kind: "PERSON", personId: person.id, name: `${person.firstName} ${person.lastName}` };
    }
    case "NEW":
      return { kind: "NEW", firstName: input.firstName!, lastName: input.lastName!, name: `${input.firstName} ${input.lastName}` };
  }
}

async function personFor(
  tx: Prisma.TransactionClient,
  context: UserContext,
  subject: Subject,
  input: CreateEmployeeProfileInput,
  jobTitle: string | null,
): Promise<string> {
  switch (subject.kind) {
    case "MEMBER":
      return personForMember(tx, context, { userId: subject.userId, jobTitle: subject.jobTitle });
    case "PERSON":
      // Hired: a candidate or a former employee is an employee again.
      await tx.personProfile.updateMany({
        where: { id: subject.personId, parentGroupId: context.parentGroupId, lifecycleStatus: { not: "EMPLOYEE" } },
        data: { lifecycleStatus: "EMPLOYEE" },
      });
      return subject.personId;
    case "NEW": {
      const person = await tx.personProfile.create({
        data: {
          parentGroupId: context.parentGroupId,
          firstName: subject.firstName,
          lastName: subject.lastName,
          jobTitle,
          dateOfBirth: input.dateOfBirth ? toBusinessDate(input.dateOfBirth) : null,
          workPhone: input.workPhone ?? null,
          personalPhone: input.personalPhone ?? null,
          lifecycleStatus: "EMPLOYEE",
          createdByUserId: context.userId,
        },
        select: { id: true },
      });
      await recordUserAction(
        context,
        { actionKey: AuditAction.HR_PERSON_PROFILE_CREATED, entity: { type: "PersonProfile", id: person.id, label: subject.name }, after: { lifecycleStatus: "EMPLOYEE" } },
        { tx },
      );
      return person.id;
    }
  }
}

/**
 * People of this group who might be the one being added (E-04 §92, §176): the
 * same name, the same date of birth with the same surname, or the same phone.
 * A name alone is a warning, never a refusal — two people can share one.
 */
export async function probableDuplicates(
  context: UserContext,
  input: { firstName?: string; lastName?: string; dateOfBirth?: Date; workPhone?: string; personalPhone?: string },
): Promise<ProbableDuplicate[]> {
  const or: Prisma.PersonProfileWhereInput[] = [];
  if (input.firstName && input.lastName) {
    or.push({ firstName: { equals: input.firstName.trim(), mode: "insensitive" }, lastName: { equals: input.lastName.trim(), mode: "insensitive" } });
  }
  if (input.lastName && input.dateOfBirth) {
    or.push({ lastName: { equals: input.lastName.trim(), mode: "insensitive" }, dateOfBirth: toBusinessDate(input.dateOfBirth) });
  }
  const phones = [input.workPhone, input.personalPhone].filter((phone): phone is string => Boolean(phone && phone.trim()));
  for (const phone of phones) {
    or.push({ workPhone: phone.trim() }, { personalPhone: phone.trim() });
  }
  if (or.length === 0) return [];

  const people = await prisma.personProfile.findMany({
    where: { parentGroupId: context.parentGroupId, OR: or },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      workPhone: true,
      personalPhone: true,
      employments: { select: { company: { select: { name: true } } } },
    },
    take: 10,
  });
  return people.map((person) => {
    const reasons: string[] = [];
    if (input.firstName && input.lastName && person.firstName.toLowerCase() === input.firstName.trim().toLowerCase() && person.lastName.toLowerCase() === input.lastName.trim().toLowerCase()) reasons.push("Same name");
    if (input.dateOfBirth && person.dateOfBirth && businessDateString(person.dateOfBirth) === businessDateString(toBusinessDate(input.dateOfBirth))) reasons.push("Same date of birth");
    if (phones.some((phone) => phone.trim() === person.workPhone || phone.trim() === person.personalPhone)) reasons.push("Same phone");
    return {
      personId: person.id,
      name: `${person.firstName} ${person.lastName}`,
      companies: [...new Set(person.employments.map((employment) => employment.company.name))],
      reasons,
    };
  });
}

/** One of this company's trades, still in use (E-04 §11). */
async function validateTrade(tx: Prisma.TransactionClient, companyId: string, tradeId: string): Promise<{ id: string }> {
  const trade = await tx.workforceTrade.findFirst({ where: { id: tradeId, companyId }, select: { id: true, name: true, isActive: true } });
  if (!trade) throw new AccessError("VALIDATION_ERROR", "That trade is not one of this company's.", { field: "tradeId" });
  if (!trade.isActive) throw new AccessError("VALIDATION_ERROR", `${trade.name} is no longer offered as a trade.`, { field: "tradeId", code: "TRADE_INACTIVE" });
  return { id: trade.id };
}

function managerName(manager: {
  user: { firstName: string; lastName: string };
}): string {
  return `${manager.user.firstName} ${manager.user.lastName}`;
}

function personLabel(row: { personProfile: { firstName: string; lastName: string } }): string {
  return `${row.personProfile.firstName} ${row.personProfile.lastName}`;
}

async function assertNumberIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  employeeNumber: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.employeeProfile.findFirst({
    where: {
      companyId: context.companyId,
      employeeNumber,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError(
      "CONFLICT",
      `Employee number ${employeeNumber} is already used in this company.`,
      { field: "employeeNumber" },
    );
  }
}

/** Facts that make an action unavailable for a reason other than permission. */
async function employmentGuards(
  context: UserContext,
  profileId: string,
  memberId: string | null,
): Promise<EmployeeDetailDTO["guards"]> {
  const [openLeaveRequests, managedEmployees] = await Promise.all([
    prisma.leaveRequest.count({
      where: { employeeProfileId: profileId, companyId: context.companyId, status: { in: ["PENDING", "APPROVED"] } },
    }),
    memberId
      ? prisma.employeeProfile.count({ where: { companyId: context.companyId, managerMemberId: memberId } })
      : Promise.resolve(0),
  ]);

  return { openLeaveRequests, managedEmployees };
}

/* -------------------------------------------------------------------------- */
/* DTO mapping                                                                 */
/* -------------------------------------------------------------------------- */

export function toSummaryDTO(row: repository.EmployeeRow): EmployeeSummaryDTO {
  const { firstName, lastName } = row.personProfile;
  return {
    id: row.id,
    memberId: row.companyMemberId,
    personId: row.personProfileId,
    name: { firstName, lastName, fullName: `${firstName} ${lastName}` },
    email: row.personProfile.workEmail ?? row.companyMember?.user.email ?? null,
    avatarUrl: row.companyMember?.user.avatarUrl ?? null,
    employeeNumber: row.employeeNumber,
    jobTitle: row.jobTitle ?? row.companyMember?.jobTitle ?? null,
    department: row.department ?? row.companyMember?.department ?? null,
    employmentStatus: row.employmentStatus,
    employmentType: row.employmentType,
    workerCategory: row.workerCategory,
    trade: row.trade,
    accountStatus: accountStatusOf(row.companyMember),
    startDate: row.startDate ? businessDateString(row.startDate) : null,
    endDate: row.endDate ? businessDateString(row.endDate) : null,
    manager: row.managerMember
      ? { memberId: row.managerMember.id, employmentId: row.managerMember.employeeProfile?.id ?? null, fullName: managerName(row.managerMember) }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetailDTO(
  context: UserContext,
  row: repository.EmployeeDetailRow,
  guards: EmployeeDetailDTO["guards"],
  currentAssignmentId: string | null,
): EmployeeDetailDTO {
  const own = isSelf(context, row.companyMemberId);
  const ended = row.employmentStatus === "ENDED";

  return {
    ...toSummaryDTO(row),
    probationEndDate: row.probationEndDate ? businessDateString(row.probationEndDate) : null,
    workLocationType: row.workLocationType,
    workLocation: row.workLocation,
    currentAssignmentId,
    weeklyHours: row.weeklyHours?.toString() ?? null,
    onboardingStatus: row.onboardingStatus,
    offboardingStatus: row.offboardingStatus,
    phone: row.personProfile.workPhone ?? row.companyMember?.user.phone ?? null,
    role: row.companyMember?.role ?? null,
    membershipStatus: row.companyMember?.status ?? null,
    createdAt: row.createdAt.toISOString(),

    capabilities: {
      canEditEmployment: !ended && can(context, "hr.employment.update"),
      canChangeStatus: can(context, "hr.employee.status.update"),
      canAssignManager: can(context, "hr.employee.manager.assign"),
      // Pay is its own decision, and seeing your own is not implied either
      // (PRD #16 §67).
      canViewCompensation: can(context, "hr.compensation.view"),
      // …and nobody records their own (PRD #47 §98).
      canEditCompensation: !own && can(context, "hr.compensation.update"),
      canViewLeave:
        can(context, "hr.leave.view") || (own && can(context, "hr.self.leave")),
      canViewAttendance:
        can(context, "hr.attendance.view") || (own && can(context, "hr.self.attendance")),
      canViewDocuments:
        (can(context, "hr.document.view") || (own && can(context, "hr.self.documents"))) &&
        can(context, "document.view"),
      canViewActivity: can(context, "hr.activity.view"),
      canManageOnboarding: can(context, "hr.onboarding.manage"),
      // The history is its own permission: the current record is not how somebody got here (E-03 §56-§59, §195).
      canViewHistory: can(context, "hr.employment_history.view") || (own && can(context, "hr.self.employment")),
      canRequestAccount: row.companyMemberId === null && !ended && can(context, "provisioning_request.create"),
    },
    employment: employmentCapabilities(context, row.employmentStatus),

    guards,
  };
}
