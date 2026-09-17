import { Prisma, type CandidateStatus, type EmploymentStatus, type PersonLifecycleStatus, type ProvisioningStatus } from "@prisma/client";

import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { can, getModuleScope } from "@/lib/access/can";
import { AccessError, assertFound, assertPermission, stateDenied } from "@/lib/access/guards";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { toBusinessDate } from "../hr.date";
import type { CandidateListQuery, CreateCandidateInput, HireCandidateInput, UpdateCandidateInput } from "./candidate.schema";

/**
 * Recruitment: the person before the login (E-06 §22-§24, §56, §62, §91).
 *
 * A candidate is a person the group is interviewing. The person is the group's
 * canonical record — created once, kept through selection and hire, and the
 * one a login is later made from — so nothing here ever copies personal data
 * into a second record (§83, §148). Hiring records the employment in the target
 * company without a membership: an employee is not a user until Group IT
 * provisions one from an approved request (§25, §28).
 *
 * Reach follows the organization module's scope: the Head of Group HR and the
 * Owner recruit across the group; HR in one company recruits into that company.
 */

const MODULE = "hr" as const;
const ENTITY = "CandidateProfile";
const PAGE_SIZE = 25;

const OPEN: CandidateStatus[] = ["INTERVIEWING", "SELECTED", "OFFERED"];

export type CandidateActionsDTO = {
  canEdit: boolean;
  canSelect: boolean;
  canReject: boolean;
  canWithdraw: boolean;
  canHire: boolean;
  canRequestAccess: boolean;
};

export type CandidateSummaryDTO = {
  id: string;
  personId: string;
  name: string;
  workEmail: string | null;
  status: CandidateStatus;
  interviewStage: string | null;
  targetCompany: { id: string; name: string } | null;
  targetDepartment: { id: string; name: string } | null;
  targetRole: { key: string; label: string } | null;
  targetJobTitle: string | null;
  updatedAt: string;
};

export type CandidateDetailDTO = CandidateSummaryDTO & {
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    workEmail: string | null;
    workPhone: string | null;
    personalEmail: string | null;
    personalPhone: string | null;
    city: string | null;
    country: string | null;
    lifecycleStatus: PersonLifecycleStatus;
    hasAccount: boolean;
  };
  hiringManager: { userId: string; name: string } | null;
  /** HR-private (E-08 §30): only for those who manage candidates. */
  notes: string | null;
  decidedAt: string | null;
  employment: { id: string; companyName: string; status: EmploymentStatus; employeeNumber: string | null; hasLogin: boolean } | null;
  provisioning: { id: string; status: ProvisioningStatus; updatedAt: string } | null;
  actions: CandidateActionsDTO;
};

/* -------------------------------------------------------------------------- */
/* Reach                                                                       */
/* -------------------------------------------------------------------------- */

export function recruitsAcrossGroup(context: UserContext): boolean {
  const scope = getModuleScope(context, "organization");
  return scope === "GROUP" || scope === "SYSTEM";
}

function reachWhere(context: UserContext): Prisma.CandidateProfileWhereInput {
  return recruitsAcrossGroup(context)
    ? { parentGroupId: context.parentGroupId }
    : { parentGroupId: context.parentGroupId, targetCompanyId: context.companyId };
}

function assertRecruitment(context: UserContext, permission: "candidate.view" | "candidate.manage"): void {
  assertPermission(context, permission);
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const SUMMARY_SELECT = {
  id: true,
  status: true,
  interviewStage: true,
  targetJobTitle: true,
  targetRoleKey: true,
  updatedAt: true,
  person: { select: { id: true, firstName: true, lastName: true, workEmail: true } },
  targetCompany: { select: { id: true, name: true } },
  targetDepartment: { select: { id: true, name: true } },
} satisfies Prisma.CandidateProfileSelect;

type SummaryRow = Prisma.CandidateProfileGetPayload<{ select: typeof SUMMARY_SELECT }>;

function toSummary(row: SummaryRow): CandidateSummaryDTO {
  return {
    id: row.id,
    personId: row.person.id,
    name: `${row.person.firstName} ${row.person.lastName}`,
    workEmail: row.person.workEmail,
    status: row.status,
    interviewStage: row.interviewStage,
    targetCompany: row.targetCompany,
    targetDepartment: row.targetDepartment,
    targetRole: row.targetRoleKey && isMembershipRoleKey(row.targetRoleKey) ? { key: row.targetRoleKey, label: roleLabel(row.targetRoleKey) } : null,
    targetJobTitle: row.targetJobTitle,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCandidates(context: UserContext, query: CandidateListQuery) {
  assertRecruitment(context, "candidate.view");
  const where: Prisma.CandidateProfileWhereInput = {
    AND: [
      reachWhere(context),
      query.status ? { status: query.status } : {},
      query.q
        ? {
            person: {
              OR: [
                { firstName: { contains: query.q, mode: "insensitive" } },
                { lastName: { contains: query.q, mode: "insensitive" } },
                { workEmail: { contains: query.q, mode: "insensitive" } },
              ],
            },
          }
        : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.candidateProfile.count({ where }),
    prisma.candidateProfile.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { data: rows.map(toSummary), meta: paginationMeta(total, query.page, PAGE_SIZE) };
}

export async function getCandidate(context: UserContext, candidateId: string): Promise<CandidateDetailDTO> {
  assertRecruitment(context, "candidate.view");
  const row = assertFound(
    await prisma.candidateProfile.findFirst({
      where: { AND: [{ id: candidateId }, reachWhere(context)] },
      select: {
        ...SUMMARY_SELECT,
        notes: true,
        decidedAt: true,
        hiringManagerUserId: true,
        targetCompanyId: true,
        personProfileId: true,
        person: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            workEmail: true,
            workPhone: true,
            personalEmail: true,
            personalPhone: true,
            city: true,
            country: true,
            lifecycleStatus: true,
            user: { select: { id: true } },
          },
        },
      },
    }),
  );

  const [manager, employment, provisioning] = await Promise.all([
    row.hiringManagerUserId
      ? prisma.user.findFirst({
          where: { id: row.hiringManagerUserId, memberships: { some: { company: { parentGroupId: context.parentGroupId } } } },
          select: { id: true, firstName: true, lastName: true },
        })
      : null,
    row.targetCompanyId ? employmentFor(row.personProfileId, row.targetCompanyId) : null,
    row.targetCompanyId
      ? prisma.userProvisioningRequest.findFirst({
          where: { personProfileId: row.personProfileId, companyId: row.targetCompanyId },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, updatedAt: true },
        })
      : null,
  ]);

  const manages = can(context, "candidate.manage");
  const open = OPEN.includes(row.status);
  const liveRequest = provisioning && !["REJECTED", "CANCELLED"].includes(provisioning.status);

  return {
    ...toSummary(row),
    person: {
      id: row.person.id,
      firstName: row.person.firstName,
      lastName: row.person.lastName,
      preferredName: row.person.preferredName,
      workEmail: row.person.workEmail,
      workPhone: row.person.workPhone,
      personalEmail: row.person.personalEmail,
      personalPhone: row.person.personalPhone,
      city: row.person.city,
      country: row.person.country,
      lifecycleStatus: row.person.lifecycleStatus,
      hasAccount: row.person.user !== null,
    },
    hiringManager: manager ? { userId: manager.id, name: `${manager.firstName} ${manager.lastName}` } : null,
    notes: manages ? row.notes : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    employment: employment
      ? { id: employment.id, companyName: employment.company.name, status: employment.employmentStatus, employeeNumber: employment.employeeNumber, hasLogin: employment.companyMemberId !== null }
      : null,
    provisioning: provisioning ? { id: provisioning.id, status: provisioning.status, updatedAt: provisioning.updatedAt.toISOString() } : null,
    actions: {
      canEdit: manages && open,
      canSelect: manages && row.status === "INTERVIEWING",
      canReject: manages && open,
      canWithdraw: manages && open,
      canHire: manages && can(context, "employment.manage") && (row.status === "SELECTED" || row.status === "OFFERED"),
      canRequestAccess:
        can(context, "provisioning_request.create") &&
        ["SELECTED", "OFFERED", "HIRED"].includes(row.status) &&
        employment !== null &&
        employment.companyMemberId === null &&
        !liveRequest,
    },
  };
}

async function employmentFor(personProfileId: string, companyId: string) {
  return prisma.employeeProfile.findFirst({
    where: { personProfileId, companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, employmentStatus: true, employeeNumber: true, companyMemberId: true, company: { select: { name: true } } },
  });
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

type Targets = {
  targetCompanyId: string;
  targetDepartmentId: string | null;
  targetRoleKey: string | null;
  targetJobTitle: string | null;
  hiringManagerUserId: string | null;
};

/**
 * Where the candidate is being recruited to, checked inside the group. HR in one
 * company recruits into that company only; a department is that company's
 * branch of a group department; a hiring manager works in that company.
 */
async function resolveTargets(context: UserContext, input: CreateCandidateInput | UpdateCandidateInput): Promise<Targets> {
  const targetCompanyId = input.targetCompanyId ?? context.companyId;
  if (targetCompanyId !== context.companyId && !recruitsAcrossGroup(context)) {
    throw new AccessError("VALIDATION_ERROR", "You recruit into your own company only.", { field: "targetCompanyId" });
  }
  const company = await prisma.company.findFirst({
    where: { id: targetCompanyId, parentGroupId: context.parentGroupId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!company) throw new AccessError("VALIDATION_ERROR", "Choose a company of your group.", { field: "targetCompanyId" });

  if (input.targetDepartmentId) {
    const department = await prisma.department.findFirst({
      where: { id: input.targetDepartmentId, companyId: targetCompanyId, status: "ACTIVE", groupDepartmentId: { not: null } },
      select: { id: true },
    });
    if (!department) throw new AccessError("VALIDATION_ERROR", "Choose a department of that company.", { field: "targetDepartmentId" });
  }

  if (input.hiringManagerUserId) {
    const manager = await prisma.companyMember.findFirst({
      where: { userId: input.hiringManagerUserId, companyId: targetCompanyId, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { id: true },
    });
    if (!manager) throw new AccessError("VALIDATION_ERROR", "The hiring manager must work in that company.", { field: "hiringManagerUserId" });
  }

  return {
    targetCompanyId,
    targetDepartmentId: input.targetDepartmentId ?? null,
    targetRoleKey: input.targetRoleKey ?? null,
    targetJobTitle: input.targetJobTitle ?? null,
    hiringManagerUserId: input.hiringManagerUserId ?? null,
  };
}

/** One person, one record (§83): an address already on a person of the group is that person. */
async function assertNoDuplicatePerson(
  tx: Prisma.TransactionClient,
  context: UserContext,
  emails: Array<string | undefined>,
  exceptPersonId: string | null,
): Promise<void> {
  const addresses = emails.filter((value): value is string => Boolean(value));
  if (addresses.length === 0) return;
  const clash = await tx.personProfile.findFirst({
    where: {
      parentGroupId: context.parentGroupId,
      ...(exceptPersonId ? { id: { not: exceptPersonId } } : {}),
      OR: addresses.flatMap((address) => [
        { workEmail: { equals: address, mode: "insensitive" as const } },
        { personalEmail: { equals: address, mode: "insensitive" as const } },
      ]),
    },
    select: { firstName: true, lastName: true },
  });
  if (clash) {
    throw new AccessError("CONFLICT", `${clash.firstName} ${clash.lastName} already has that email address in the group.`, {
      code: "PERSON_EXISTS",
    });
  }
}

function personData(input: CreateCandidateInput | UpdateCandidateInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    preferredName: input.preferredName ?? null,
    workEmail: input.workEmail ?? null,
    workPhone: input.workPhone ?? null,
    personalEmail: input.personalEmail ?? null,
    personalPhone: input.personalPhone ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
  };
}

export async function createCandidate(context: UserContext, input: CreateCandidateInput): Promise<CandidateDetailDTO> {
  assertRecruitment(context, "candidate.manage");
  assertPermission(context, "person_profile.create");
  const targets = await resolveTargets(context, input);

  const candidateId = await prisma.$transaction(async (tx) => {
    await assertNoDuplicatePerson(tx, context, [input.workEmail, input.personalEmail], null);
    const person = await tx.personProfile.create({
      data: {
        parentGroupId: context.parentGroupId,
        ...personData(input),
        jobTitle: targets.targetJobTitle,
        lifecycleStatus: "CANDIDATE",
        createdByUserId: context.userId,
      },
      select: { id: true },
    });
    const candidate = await tx.candidateProfile.create({
      data: {
        parentGroupId: context.parentGroupId,
        personProfileId: person.id,
        ...targets,
        status: "INTERVIEWING",
        interviewStage: input.interviewStage ?? null,
        notes: input.notes ?? null,
        createdByUserId: context.userId,
      },
      select: { id: true },
    });

    const name = `${input.firstName} ${input.lastName}`;
    await recordUserAction(
      context,
      { actionKey: AuditAction.HR_PERSON_PROFILE_CREATED, entity: { type: "PersonProfile", id: person.id, label: name }, after: { lifecycleStatus: "CANDIDATE" } },
      { tx },
    );
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.HR_CANDIDATE_CREATED,
        entity: { type: ENTITY, id: candidate.id, label: name },
        after: { status: "INTERVIEWING", targetCompanyId: targets.targetCompanyId, targetDepartmentId: targets.targetDepartmentId, targetRoleKey: targets.targetRoleKey },
      },
      { tx },
    );
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: candidate.id,
      action: "HR_CANDIDATE_CREATED",
      message: `added ${name} as a candidate`,
    });
    return candidate.id;
  });

  return getCandidate(context, candidateId);
}

async function openCandidate(context: UserContext, candidateId: string) {
  return assertFound(
    await prisma.candidateProfile.findFirst({
      where: { AND: [{ id: candidateId }, reachWhere(context)] },
      select: {
        id: true,
        status: true,
        personProfileId: true,
        targetCompanyId: true,
        targetDepartmentId: true,
        targetRoleKey: true,
        targetJobTitle: true,
        hiringManagerUserId: true,
        person: { select: { firstName: true, lastName: true, lifecycleStatus: true } },
      },
    }),
  );
}

export async function updateCandidate(context: UserContext, candidateId: string, input: UpdateCandidateInput): Promise<CandidateDetailDTO> {
  assertRecruitment(context, "candidate.manage");
  assertPermission(context, "person_profile.update");
  const candidate = await openCandidate(context, candidateId);
  if (!OPEN.includes(candidate.status)) throw stateDenied("A decided candidate can no longer be changed.");
  const targets = await resolveTargets(context, input);

  await prisma.$transaction(async (tx) => {
    await assertNoDuplicatePerson(tx, context, [input.workEmail, input.personalEmail], candidate.personProfileId);
    const person = personData(input);
    await tx.personProfile.updateMany({
      where: { id: candidate.personProfileId, parentGroupId: context.parentGroupId },
      data: {
        firstName: person.firstName,
        lastName: person.lastName,
        preferredName: person.preferredName,
        workEmail: person.workEmail,
        workPhone: person.workPhone,
        personalEmail: person.personalEmail,
        personalPhone: person.personalPhone,
        city: person.city,
        country: person.country,
      },
    });
    const moved = await tx.candidateProfile.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { ...targets, interviewStage: input.interviewStage ?? null, notes: input.notes ?? null },
    });
    if (moved.count === 0) throw new AccessError("CONFLICT", "Somebody else changed this candidate. Reload and try again.");
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: candidate.id,
      action: "HR_CANDIDATE_UPDATED",
      message: `updated ${input.firstName} ${input.lastName}'s candidate profile`,
    });
  });

  return getCandidate(context, candidate.id);
}

/**
 * A decision on a candidate. The status the decision was made from is part of
 * the write, so two people deciding at once cannot overwrite each other.
 */
async function decide(
  context: UserContext,
  candidateId: string,
  from: readonly CandidateStatus[],
  to: CandidateStatus,
  person: PersonLifecycleStatus | null,
): Promise<CandidateDetailDTO> {
  assertRecruitment(context, "candidate.manage");
  const candidate = await openCandidate(context, candidateId);
  if (!from.includes(candidate.status)) {
    throw stateDenied(`This candidate is ${candidate.status.toLowerCase()} and cannot be marked ${to.toLowerCase()}.`);
  }
  const name = `${candidate.person.firstName} ${candidate.person.lastName}`;

  await prisma.$transaction(async (tx) => {
    const moved = await tx.candidateProfile.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { status: to, decidedAt: new Date(), decidedByUserId: context.userId },
    });
    if (moved.count === 0) throw new AccessError("CONFLICT", "Somebody else decided on this candidate first.");
    if (person) {
      await tx.personProfile.updateMany({
        where: { id: candidate.personProfileId, lifecycleStatus: candidate.person.lifecycleStatus },
        data: { lifecycleStatus: person },
      });
    }
    if (to === "SELECTED") {
      await recordUserAction(
        context,
        { actionKey: AuditAction.HR_CANDIDATE_SELECTED, entity: { type: ENTITY, id: candidate.id, label: name }, before: { status: candidate.status }, after: { status: to } },
        { tx },
      );
    }
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: candidate.id,
      action: `HR_CANDIDATE_${to}`,
      message: `marked ${name} ${to.toLowerCase()}`,
    });
  });

  return getCandidate(context, candidate.id);
}

export function selectCandidate(context: UserContext, candidateId: string) {
  return decide(context, candidateId, ["INTERVIEWING"], "SELECTED", "SELECTED");
}

export function rejectCandidate(context: UserContext, candidateId: string) {
  return decide(context, candidateId, OPEN, "REJECTED", null);
}

export function withdrawCandidate(context: UserContext, candidateId: string) {
  return decide(context, candidateId, OPEN, "WITHDRAWN", null);
}

/**
 * The candidate wins the position (§24): the same person, now employed in the
 * target company, with no login. The employment is planned until HR starts it,
 * and the account is a separate request (§28). An employment HR already
 * planned for this person there is the one they are hired into, not a second.
 */
export async function hireCandidate(context: UserContext, candidateId: string, input: HireCandidateInput): Promise<CandidateDetailDTO> {
  assertRecruitment(context, "candidate.manage");
  assertPermission(context, "employment.manage");
  const candidate = await openCandidate(context, candidateId);
  if (candidate.status !== "SELECTED" && candidate.status !== "OFFERED") {
    throw stateDenied("Only a selected candidate can be hired.");
  }
  const missing = (
    [
      ["targetCompanyId", "company"],
      ["targetDepartmentId", "department"],
      ["targetRoleKey", "role"],
      ["targetJobTitle", "job title"],
    ] as const
  ).filter(([field]) => !candidate[field]);
  if (missing.length > 0) {
    throw new AccessError("VALIDATION_ERROR", `Confirm the ${missing.map(([, label]) => label).join(", ")} before hiring.`, {
      code: "HIRE_INCOMPLETE",
      fields: missing.map(([field]) => field),
    });
  }
  const companyId = candidate.targetCompanyId!;
  // The employment is the target company's record, audited there (E-06 §161).
  const acting = (await contextInCompany(context, companyId)) ?? context;
  const name = `${candidate.person.firstName} ${candidate.person.lastName}`;

  const manager = candidate.hiringManagerUserId
    ? await prisma.companyMember.findFirst({ where: { userId: candidate.hiringManagerUserId, companyId, status: "ACTIVE" }, select: { id: true } })
    : null;

  await prisma.$transaction(async (tx) => {
    if (input.employeeNumber) {
      const clash = await tx.employeeProfile.findFirst({ where: { companyId, employeeNumber: input.employeeNumber }, select: { id: true } });
      if (clash) throw new AccessError("CONFLICT", `Employee number ${input.employeeNumber} is already used in that company.`, { field: "employeeNumber" });
    }
    const moved = await tx.candidateProfile.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { status: "HIRED", decidedAt: new Date(), decidedByUserId: context.userId },
    });
    if (moved.count === 0) throw new AccessError("CONFLICT", "Somebody else decided on this candidate first.");

    const planned = await tx.employeeProfile.findFirst({
      where: { companyId, personProfileId: candidate.personProfileId, employmentStatus: { in: ["PLANNED", "ACTIVE"] } },
      select: { id: true },
    });
    const employment = planned ?? await tx.employeeProfile.create({
      data: {
        companyId,
        personProfileId: candidate.personProfileId,
        companyMemberId: null,
        employeeNumber: input.employeeNumber ?? null,
        employmentStatus: "PLANNED",
        employmentType: input.employmentType,
        startDate: input.startDate ? toBusinessDate(input.startDate) : null,
        managerMemberId: manager?.id ?? null,
        createdByMemberId: acting.companyId === companyId ? acting.membershipId : null,
      },
      select: { id: true },
    });
    await tx.personProfile.updateMany({
      where: { id: candidate.personProfileId, lifecycleStatus: candidate.person.lifecycleStatus },
      data: { lifecycleStatus: "EMPLOYEE", jobTitle: candidate.targetJobTitle },
    });

    if (!planned) await recordUserAction(
      acting,
      {
        actionKey: AuditAction.HR_EMPLOYEE_CREATED,
        entity: { type: "EmployeeProfile", id: employment.id, label: name },
        after: { employmentStatus: "PLANNED", personProfileId: candidate.personProfileId, departmentId: candidate.targetDepartmentId, roleKey: candidate.targetRoleKey },
      },
      { tx },
    );
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: candidate.id,
      action: "HR_CANDIDATE_HIRED",
      message: `hired ${name}`,
      metadata: { employeeProfileId: employment.id } as Prisma.InputJsonValue,
    });
  });

  return getCandidate(context, candidate.id);
}
