import type { Prisma, ProvisioningStatus } from "@prisma/client";

import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { can, canAny, getModuleScope } from "@/lib/access/can";
import { AccessError, assertFound, assertPermission } from "@/lib/access/guards";
import { createProvisionedUser } from "@/lib/auth/identity";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "@/lib/auth/temporary-password";
import { normaliseUsername, suggestUsername, usernameProblem } from "@/lib/auth/username";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { assertTransitionAllowed, applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { linkEmploymentToLogin } from "@/lib/modules/hr/hr.person";
import { RECRUITABLE_ROLE_KEYS } from "@/lib/modules/hr/recruitment/candidate.schema";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { createProvisionedMembership } from "@/lib/modules/team/team.provisioning";
import { provisioningRequestMachine, type ProvisioningAction } from "./provisioning.machine";
import type { CreateProvisioningRequestInput, ProvisionInput, ProvisioningListQuery } from "./provisioning.schema";

/**
 * Account requests between HR and Group IT (E-06 §27-§29, §64, §92, §93, §119).
 *
 * HR raises a request from an employment it recorded. The Head of Group HR or
 * the Group Owner decides that the person gets a login, and never for a request
 * they raised themselves. Group IT creates the account from the approved HR
 * truth: the user, the membership, the department assignment and the link to
 * the employment in one transaction, or none of them (§93). IT chooses the
 * username and nothing else; anything wrong with the HR data goes back to HR
 * with a reason (§29).
 *
 * A request belongs to the company the person will work in. Group-wide readers
 * — the Owner, Group IT, the Head of Group HR — see every company's requests
 * and act on one as their membership in that company, so its permissions
 * decide and its log records it (§161). Everyone else sees their own company's.
 */

const MODULE = "organization" as const;
const ENTITY = "UserProvisioningRequest";
const PAGE_SIZE = 25;

export type ProvisioningActionsDTO = {
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
  canStart: boolean;
  canProvision: boolean;
  canCancel: boolean;
};

type PersonRef = { userId: string; name: string };

export type ProvisioningSummaryDTO = {
  id: string;
  status: ProvisioningStatus;
  person: { id: string; name: string };
  company: { id: string; name: string };
  department: { id: string; name: string };
  role: { key: string; label: string };
  jobTitle: string | null;
  submittedAt: string | null;
  updatedAt: string;
};

export type ProvisioningDetailDTO = ProvisioningSummaryDTO & {
  /** What HR recorded, shown to IT read-only (§29, §64). */
  hrTruth: {
    firstName: string;
    lastName: string;
    workEmail: string | null;
    workPhone: string | null;
    employeeNumber: string | null;
    employmentStatus: string | null;
    manager: PersonRef | null;
  };
  requestedUsername: string | null;
  suggestedUsername: string;
  requestedActivationDate: string | null;
  notes: string | null;
  existingAccount: { username: string } | null;
  requestedBy: PersonRef | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  returnReason: string | null;
  returnedAt: string | null;
  rejectionReason: string | null;
  provisionedBy: PersonRef | null;
  provisionedAt: string | null;
  provisionedUser: { id: string; username: string } | null;
  actions: ProvisioningActionsDTO;
};

export type ProvisionResultDTO = {
  requestId: string;
  userId: string;
  username: string;
  /** Shown once, to the person who created the account (PRD #50 §18). Null when the person already had a login. */
  temporaryPassword: string | null;
  expiresAt: string | null;
  newAccount: boolean;
};

/* -------------------------------------------------------------------------- */
/* Reach                                                                       */
/* -------------------------------------------------------------------------- */

function groupWide(context: UserContext): boolean {
  const scope = getModuleScope(context, MODULE);
  return scope === "GROUP" || scope === "SYSTEM";
}

function reachWhere(context: UserContext): Prisma.UserProvisioningRequestWhereInput {
  return groupWide(context)
    ? { parentGroupId: context.parentGroupId }
    : { parentGroupId: context.parentGroupId, companyId: context.companyId };
}

function canRead(context: UserContext): boolean {
  return canAny(context, ["organization.provisioning_request.view", "provisioning_request.create"]);
}

/** The reader acting in the request's company, or not found (§161). */
async function actingIn(context: UserContext, companyId: string): Promise<UserContext> {
  const acting = await contextInCompany(context, companyId);
  if (!acting) throw new AccessError("NOT_FOUND");
  return acting;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const SUMMARY_SELECT = {
  id: true,
  status: true,
  jobTitle: true,
  functionalRoleKey: true,
  submittedAt: true,
  updatedAt: true,
  person: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  companyDepartment: { select: { id: true, name: true } },
} satisfies Prisma.UserProvisioningRequestSelect;

type SummaryRow = Prisma.UserProvisioningRequestGetPayload<{ select: typeof SUMMARY_SELECT }>;

function roleRef(key: string): { key: string; label: string } {
  return { key, label: isMembershipRoleKey(key) ? roleLabel(key) : key };
}

function toSummary(row: SummaryRow): ProvisioningSummaryDTO {
  return {
    id: row.id,
    status: row.status,
    person: { id: row.person.id, name: `${row.person.firstName} ${row.person.lastName}` },
    company: row.company,
    department: row.companyDepartment,
    role: roleRef(row.functionalRoleKey),
    jobTitle: row.jobTitle,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProvisioningRequests(context: UserContext, query: ProvisioningListQuery) {
  if (!canRead(context)) throw new AccessError("FORBIDDEN");
  const where: Prisma.UserProvisioningRequestWhereInput = {
    AND: [reachWhere(context), query.status ? { status: query.status } : {}],
  };
  const [total, rows] = await Promise.all([
    prisma.userProvisioningRequest.count({ where }),
    prisma.userProvisioningRequest.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { data: rows.map(toSummary), meta: paginationMeta(total, query.page, PAGE_SIZE) };
}

async function findInReach(context: UserContext, requestId: string) {
  return assertFound(
    await prisma.userProvisioningRequest.findFirst({
      where: { AND: [{ id: requestId }, reachWhere(context)] },
      select: {
        ...SUMMARY_SELECT,
        parentGroupId: true,
        companyId: true,
        companyDepartmentId: true,
        personProfileId: true,
        employeeProfileId: true,
        managerUserId: true,
        requestedUsername: true,
        requestedActivationDate: true,
        notes: true,
        requestedByUserId: true,
        approvedByUserId: true,
        approvedAt: true,
        returnReason: true,
        returnedAt: true,
        rejectionReason: true,
        provisionedByUserId: true,
        provisionedAt: true,
        provisionedUser: { select: { id: true, username: true } },
        person: { select: { id: true, firstName: true, lastName: true, workEmail: true, workPhone: true, user: { select: { id: true, username: true, status: true } } } },
        employeeProfile: { select: { id: true, employeeNumber: true, employmentStatus: true, companyMemberId: true } },
        companyDepartment: { select: { id: true, name: true, status: true, groupDepartmentId: true } },
        company: { select: { id: true, name: true, status: true } },
      },
    }),
  );
}

type RequestRow = Awaited<ReturnType<typeof findInReach>>;

function allowed(acting: UserContext, row: RequestRow, action: ProvisioningAction): boolean {
  try {
    assertTransitionAllowed(provisioningRequestMachine, { currentState: row.status, action, context: acting, reason: "-" });
    return true;
  } catch {
    return false;
  }
}

export async function getProvisioningRequest(context: UserContext, requestId: string): Promise<ProvisioningDetailDTO> {
  if (!canRead(context)) throw new AccessError("FORBIDDEN");
  const row = await findInReach(context, requestId);
  const acting = (await contextInCompany(context, row.companyId)) ?? context;

  const userIds = [row.managerUserId, row.requestedByUserId, row.approvedByUserId, row.provisionedByUserId].filter((id): id is string => Boolean(id));
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } });
  const name = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`]));
  const ref = (id: string | null): PersonRef | null => (id && name.has(id) ? { userId: id, name: name.get(id)! } : null);

  const ownRequest = row.requestedByUserId === context.userId;
  return {
    ...toSummary(row),
    hrTruth: {
      firstName: row.person.firstName,
      lastName: row.person.lastName,
      workEmail: row.person.workEmail,
      workPhone: row.person.workPhone,
      employeeNumber: row.employeeProfile?.employeeNumber ?? null,
      employmentStatus: row.employeeProfile?.employmentStatus ?? null,
      manager: ref(row.managerUserId),
    },
    requestedUsername: row.requestedUsername,
    suggestedUsername: suggestUsername(row.person.firstName, row.person.lastName),
    requestedActivationDate: row.requestedActivationDate?.toISOString() ?? null,
    notes: row.notes,
    existingAccount: row.person.user ? { username: row.person.user.username } : null,
    requestedBy: ref(row.requestedByUserId),
    approvedBy: ref(row.approvedByUserId),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    returnReason: row.returnReason,
    returnedAt: row.returnedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    provisionedBy: ref(row.provisionedByUserId),
    provisionedAt: row.provisionedAt?.toISOString() ?? null,
    provisionedUser: row.provisionedUser,
    actions: {
      canSubmit: allowed(acting, row, "submit"),
      canApprove: allowed(acting, row, "approve") && !ownRequest,
      canReject: allowed(acting, row, "reject") && !ownRequest,
      canReturn: allowed(acting, row, "return"),
      canStart: allowed(acting, row, "start") && can(acting, "organization.provisioning_request.process"),
      canProvision: allowed(acting, row, "provision") && can(acting, "organization.provisioning_request.process"),
      canCancel: allowed(acting, row, "cancel"),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* HR raises a request                                                         */
/* -------------------------------------------------------------------------- */

const LIVE: ProvisioningStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "IN_PROGRESS"];

export async function createProvisioningRequest(context: UserContext, input: CreateProvisioningRequestInput): Promise<ProvisioningDetailDTO> {
  assertPermission(context, "provisioning_request.create");

  // The employment is the request's anchor: its company and its person are the request's (§27).
  const employment = assertFound(
    await prisma.employeeProfile.findFirst({
      where: {
        id: input.employeeProfileId,
        company: { parentGroupId: context.parentGroupId },
        ...(groupWide(context) ? {} : { companyId: context.companyId }),
      },
      select: { id: true, companyId: true, personProfileId: true, companyMemberId: true, personProfile: { select: { firstName: true, lastName: true } } },
    }),
  );
  if (employment.companyMemberId) {
    throw new AccessError("CONFLICT", "This employee already has a NESTO account in that company.", { code: "EMPLOYMENT_LINKED" });
  }
  const acting = await actingIn(context, employment.companyId);
  assertPermission(acting, "provisioning_request.create");
  if (input.submit) assertPermission(acting, "provisioning_request.submit");

  // What the hire confirmed, unless HR corrects it here.
  const hire = await prisma.candidateProfile.findFirst({
    where: { parentGroupId: context.parentGroupId, personProfileId: employment.personProfileId, targetCompanyId: employment.companyId, status: { in: ["SELECTED", "OFFERED", "HIRED"] } },
    orderBy: { decidedAt: "desc" },
    select: { targetDepartmentId: true, targetRoleKey: true, targetJobTitle: true, hiringManagerUserId: true },
  });
  const departmentId = input.companyDepartmentId ?? hire?.targetDepartmentId ?? null;
  const roleKey = input.functionalRoleKey ?? hire?.targetRoleKey ?? null;
  const jobTitle = input.jobTitle ?? hire?.targetJobTitle ?? null;
  const managerUserId = input.managerUserId ?? hire?.hiringManagerUserId ?? null;
  if (!departmentId) throw new AccessError("VALIDATION_ERROR", "Choose the department the person joins.", { field: "companyDepartmentId" });
  if (!roleKey || !RECRUITABLE_ROLE_KEYS.includes(roleKey)) throw new AccessError("VALIDATION_ERROR", "Choose the person's role.", { field: "functionalRoleKey" });
  await assertDepartment(employment.companyId, departmentId);
  if (managerUserId) await assertManager(employment.companyId, managerUserId);
  const requestedUsername = input.requestedUsername ? checkedUsername(input.requestedUsername) : null;

  const requestId = await prisma.$transaction(async (tx) => {
    const live = await tx.userProvisioningRequest.findFirst({
      where: { personProfileId: employment.personProfileId, companyId: employment.companyId, status: { in: LIVE } },
      select: { id: true },
    });
    if (live) throw new AccessError("CONFLICT", "An account request for this person is already open.", { code: "REQUEST_OPEN" });

    const now = new Date();
    const request = await tx.userProvisioningRequest.create({
      data: {
        parentGroupId: context.parentGroupId,
        personProfileId: employment.personProfileId,
        employeeProfileId: employment.id,
        companyId: employment.companyId,
        companyDepartmentId: departmentId,
        functionalRoleKey: roleKey,
        jobTitle,
        managerUserId,
        requestedUsername,
        requestedActivationDate: input.requestedActivationDate ?? null,
        notes: input.notes ?? null,
        status: input.submit ? "SUBMITTED" : "DRAFT",
        requestedByUserId: context.userId,
        submittedAt: input.submit ? now : null,
      },
      select: { id: true },
    });
    const personName = `${employment.personProfile.firstName} ${employment.personProfile.lastName}`;
    if (input.submit) {
      await recordUserAction(
        acting,
        {
          actionKey: AuditAction.ORGANIZATION_USER_PROVISIONING_REQUESTED,
          entity: { type: ENTITY, id: request.id, label: personName },
          after: { status: "SUBMITTED", requestedByUserId: context.userId, personProfileId: employment.personProfileId, companyId: employment.companyId, companyDepartmentId: departmentId, functionalRoleKey: roleKey, managerUserId },
        },
        { tx },
      );
    }
    await recordActivity(tx, acting, {
      module: MODULE,
      entityType: ENTITY,
      entityId: request.id,
      action: input.submit ? "PROVISIONING_REQUEST_SUBMITTED" : "PROVISIONING_REQUEST_DRAFTED",
      message: `${input.submit ? "requested" : "drafted a request for"} a NESTO account for ${personName}`,
    });
    return request.id;
  });

  return getProvisioningRequest(context, requestId);
}

async function assertDepartment(companyId: string, departmentId: string): Promise<{ groupDepartmentId: string }> {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, companyId, status: "ACTIVE", groupDepartmentId: { not: null } },
    select: { groupDepartmentId: true },
  });
  if (!department?.groupDepartmentId) {
    throw new AccessError("VALIDATION_ERROR", "Choose an active department of that company.", { field: "companyDepartmentId" });
  }
  return { groupDepartmentId: department.groupDepartmentId };
}

async function assertManager(companyId: string, managerUserId: string): Promise<{ memberId: string }> {
  const manager = await prisma.companyMember.findFirst({
    where: { userId: managerUserId, companyId, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (!manager) throw new AccessError("VALIDATION_ERROR", "The manager must be an active member of that company.", { field: "managerUserId" });
  return { memberId: manager.id };
}

function checkedUsername(value: string): string {
  const username = normaliseUsername(value);
  if (usernameProblem(username)) {
    throw new AccessError("VALIDATION_ERROR", "Usernames use lowercase letters, numbers, dots, hyphens and underscores.", { field: "username" });
  }
  return username;
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

type Move = {
  action: Exclude<ProvisioningAction, "provision">;
  data: (now: Date, userId: string, reason: string | null) => Record<string, unknown>;
  audit: string | null;
  message: string;
};

const MOVES: Record<Exclude<ProvisioningAction, "provision">, Move> = {
  submit: { action: "submit", data: (now) => ({ submittedAt: now }), audit: AuditAction.ORGANIZATION_USER_PROVISIONING_REQUESTED, message: "requested a NESTO account for" },
  approve: { action: "approve", data: (now, userId) => ({ approvedAt: now, approvedByUserId: userId }), audit: AuditAction.ORGANIZATION_USER_PROVISIONING_APPROVED, message: "approved a NESTO account for" },
  reject: { action: "reject", data: (now, userId, reason) => ({ rejectedAt: now, rejectedByUserId: userId, rejectionReason: reason }), audit: AuditAction.ORGANIZATION_USER_PROVISIONING_REJECTED, message: "rejected the account request for" },
  // Back to HR: the approval no longer stands, and neither does IT's start (§29).
  return: {
    action: "return",
    data: (now, userId, reason) => ({ returnedAt: now, returnedByUserId: userId, returnReason: reason, approvedAt: null, approvedByUserId: null, startedAt: null, startedByUserId: null, submittedAt: null }),
    audit: AuditAction.ORGANIZATION_USER_PROVISIONING_RETURNED,
    message: "returned the account request to HR for",
  },
  start: { action: "start", data: (now, userId) => ({ startedAt: now, startedByUserId: userId }), audit: null, message: "started creating the account for" },
  cancel: { action: "cancel", data: (now) => ({ cancelledAt: now }), audit: AuditAction.ORGANIZATION_USER_PROVISIONING_CANCELLED, message: "cancelled the account request for" },
};

async function move(context: UserContext, requestId: string, action: Exclude<ProvisioningAction, "provision">, reason: string | null = null): Promise<ProvisioningDetailDTO> {
  const row = await findInReach(context, requestId);
  const acting = await actingIn(context, row.companyId);
  const step = MOVES[action];

  if ((action === "approve" || action === "reject") && row.requestedByUserId === context.userId) {
    throw new AccessError("FORBIDDEN", "Somebody other than the person who asked decides an account request.", { code: "OWN_REQUEST" });
  }
  // Starting and creating the account are Group IT's work, not a business decision (§75).
  if (action === "start") assertPermission(acting, "organization.provisioning_request.process");
  // Cancelling someone else's request is IT's call or the requester's own (§64).
  if (action === "cancel" && row.requestedByUserId !== context.userId && !can(acting, "organization.provisioning_request.process")) {
    throw new AccessError("FORBIDDEN");
  }

  const personName = `${row.person.firstName} ${row.person.lastName}`;
  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: provisioningRequestMachine,
      action,
      id: row.id,
      context: acting,
      from: row.status,
      reason,
      data: step.data(new Date(), context.userId, reason),
    });
    if (step.audit) {
      const to = provisioningRequestMachine.transitions.find((transition) => transition.action === action)!.to as ProvisioningStatus;
      await recordUserAction(
        acting,
        {
          actionKey: step.audit,
          entity: { type: ENTITY, id: row.id, label: personName },
          before: { status: row.status },
          after: {
            status: to,
            requestedByUserId: row.requestedByUserId,
            ...(action === "approve" ? { approvedByUserId: context.userId } : {}),
            personProfileId: row.personProfileId,
            companyId: row.companyId,
            companyDepartmentId: row.companyDepartmentId,
            functionalRoleKey: row.functionalRoleKey,
            managerUserId: row.managerUserId,
          },
          reason,
        },
        { tx },
      );
    }
    await recordActivity(tx, acting, {
      module: MODULE,
      entityType: ENTITY,
      entityId: row.id,
      action: `PROVISIONING_REQUEST_${action.toUpperCase()}`,
      message: `${step.message} ${personName}`,
    });
  });

  return getProvisioningRequest(context, row.id);
}

export const submitProvisioningRequest = (context: UserContext, requestId: string) => move(context, requestId, "submit");
export const approveProvisioningRequest = (context: UserContext, requestId: string) => move(context, requestId, "approve");
export const rejectProvisioningRequest = (context: UserContext, requestId: string, reason: string) => move(context, requestId, "reject", reason);
export const returnProvisioningRequest = (context: UserContext, requestId: string, reason: string) => move(context, requestId, "return", reason);
export const startProvisioningRequest = (context: UserContext, requestId: string) => move(context, requestId, "start");
export const cancelProvisioningRequest = (context: UserContext, requestId: string) => move(context, requestId, "cancel");

/* -------------------------------------------------------------------------- */
/* Group IT creates the account                                               */
/* -------------------------------------------------------------------------- */

/**
 * Create User from HR Profile (§57, §93): all-or-nothing.
 *
 * Checked against the approved truth first (§119): the request was approved,
 * the person is this group's, the company is active, the department is an
 * active branch of a group department, the role is one people are hired into,
 * the manager still works there, and the employment has no login yet. A person
 * who already has a NESTO login — hired into a second company — keeps it: they
 * gain a membership, not a second identity (§83).
 */
export async function provisionAccount(context: UserContext, requestId: string, input: ProvisionInput): Promise<ProvisionResultDTO> {
  const row = await findInReach(context, requestId);
  const acting = await actingIn(context, row.companyId);
  assertPermission(acting, "organization.provisioning_request.process");
  assertTransitionAllowed(provisioningRequestMachine, { currentState: row.status, action: "provision", context: acting });

  if (!row.approvedByUserId) throw new AccessError("CONFLICT", "This request has not been approved.", { code: "NOT_APPROVED" });
  if (row.company.status !== "ACTIVE") throw new AccessError("CONFLICT", "That company is not active.", { code: "COMPANY_INACTIVE" });
  if (row.companyDepartment.status !== "ACTIVE" || !row.companyDepartment.groupDepartmentId) {
    throw new AccessError("CONFLICT", "The department on this request is no longer active. Return it to HR.", { code: "DEPARTMENT_INACTIVE" });
  }
  if (!RECRUITABLE_ROLE_KEYS.includes(row.functionalRoleKey)) {
    throw new AccessError("CONFLICT", "The role on this request cannot be given to a hire. Return it to HR.", { code: "ROLE_NOT_ALLOWED" });
  }
  if (row.employeeProfile?.companyMemberId) {
    throw new AccessError("CONFLICT", "This employee already has a NESTO account in that company.", { code: "EMPLOYMENT_LINKED" });
  }
  const existingUser = row.person.user;
  if (existingUser && existingUser.status !== "ACTIVE") {
    throw new AccessError("CONFLICT", "This person's NESTO account is not active. Reactivate it before adding a company.", { code: "ACCOUNT_INACTIVE" });
  }

  const [role, manager] = await Promise.all([
    prisma.role.findUnique({ where: { key: row.functionalRoleKey }, select: { id: true } }),
    row.managerUserId ? assertManager(row.companyId, row.managerUserId) : null,
  ]);
  if (!role) throw new AccessError("CONFLICT", "The role on this request no longer exists.", { code: "ROLE_NOT_ALLOWED" });

  const chosen = input.username ? checkedUsername(input.username) : row.requestedUsername;
  const temporaryPassword = existingUser ? null : generateTemporaryPassword();
  const expiresAt = existingUser ? null : temporaryPasswordExpiry();
  const personName = `${row.person.firstName} ${row.person.lastName}`;

  const result = await prisma.$transaction(async (tx) => {
    let user: { id: string; username: string };
    if (existingUser) {
      user = { id: existingUser.id, username: existingUser.username };
    } else {
      if (chosen && (await tx.user.count({ where: { username: chosen } })) > 0) {
        throw new AccessError("CONFLICT", "That username is taken.", { field: "username" });
      }
      if (row.person.workEmail && (await tx.user.count({ where: { email: { equals: row.person.workEmail, mode: "insensitive" } } })) > 0) {
        throw new AccessError("CONFLICT", "Another account already uses this person's work email. Return the request to HR.", { code: "EMAIL_IN_USE" });
      }
      // Auth owns the credential (PRD #48 §11).
      user = await createProvisionedUser(tx, {
        personProfileId: row.personProfileId,
        firstName: row.person.firstName,
        lastName: row.person.lastName,
        email: row.person.workEmail,
        phone: row.person.workPhone,
        username: chosen,
        temporaryPassword: temporaryPassword!,
        expiresAt: expiresAt!,
      });
    }

    // Team owns the membership, HR the employment; this module the position.
    const membership = await createProvisionedMembership(tx, {
      companyId: row.companyId,
      userId: user.id,
      roleId: role.id,
      departmentId: row.companyDepartment.id,
      jobTitle: row.jobTitle,
    });
    // Somebody who already covered this branch for the group keeps that place (E-13 §27).
    const assignment =
      (await tx.departmentAssignment.findFirst({
        where: { userId: user.id, companyDepartmentId: row.companyDepartment.id, positionLevel: "MEMBER", status: "ACTIVE" },
        select: { id: true },
      })) ??
      (await tx.departmentAssignment.create({
        data: {
          parentGroupId: row.parentGroupId,
          userId: user.id,
          groupDepartmentId: row.companyDepartment.groupDepartmentId!,
          companyId: row.companyId,
          companyDepartmentId: row.companyDepartment.id,
          functionalRoleKey: row.functionalRoleKey,
          positionLevel: "MEMBER",
          accessLevel: "CONTRIBUTE",
          status: "ACTIVE",
          startsAt: new Date(),
          createdByUserId: context.userId,
        },
        select: { id: true },
      }));
    await linkEmploymentToLogin(tx, {
      employeeProfileId: row.employeeProfile?.id ?? null,
      personProfileId: row.personProfileId,
      companyId: row.companyId,
      companyMemberId: membership.id,
      managerMemberId: manager?.memberId ?? null,
    });

    const now = new Date();
    await applyTransition(tx, {
      machine: provisioningRequestMachine,
      action: "provision",
      id: row.id,
      context: acting,
      from: row.status,
      data: { provisionedUserId: user.id, provisionedByUserId: context.userId, provisionedAt: now },
    });

    const attribution = {
      requestedByUserId: row.requestedByUserId,
      approvedByUserId: row.approvedByUserId,
      provisionedByUserId: context.userId,
      personProfileId: row.personProfileId,
      userId: user.id,
      companyId: row.companyId,
      companyDepartmentId: row.companyDepartment.id,
      functionalRoleKey: row.functionalRoleKey,
      managerUserId: row.managerUserId,
    };
    await recordUserAction(
      acting,
      {
        actionKey: AuditAction.ORGANIZATION_USER_PROVISIONED,
        entity: { type: ENTITY, id: row.id, label: personName },
        before: { status: row.status },
        after: { ...attribution, status: "PROVISIONED", username: user.username, newAccount: !existingUser, companyMemberId: membership.id },
      },
      { tx },
    );
    await recordUserAction(
      acting,
      {
        actionKey: AuditAction.ORGANIZATION_DEPARTMENT_ASSIGNMENT_CREATED,
        entity: { type: "DepartmentAssignment", id: assignment.id, label: personName },
        after: { userId: user.id, companyId: row.companyId, companyDepartmentId: row.companyDepartment.id, groupDepartmentId: row.companyDepartment.groupDepartmentId, functionalRoleKey: row.functionalRoleKey, positionLevel: "MEMBER" },
      },
      { tx },
    );
    await recordActivity(tx, acting, {
      module: MODULE,
      entityType: ENTITY,
      entityId: row.id,
      action: "PROVISIONING_REQUEST_PROVISION",
      message: existingUser ? `added ${personName}'s NESTO account to ${row.company.name}` : `created ${personName}'s NESTO account`,
    });
    return user;
  });

  return {
    requestId: row.id,
    userId: result.id,
    username: result.username,
    temporaryPassword,
    expiresAt: expiresAt?.toISOString() ?? null,
    newAccount: !existingUser,
  };
}
