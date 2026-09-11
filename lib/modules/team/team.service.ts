import { Prisma, type MembershipStatus } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import * as repository from "./team.repository";
import { canTransitionMembershipStatus } from "./membership.status";
import type { TeamListQuery, UpdateMemberInput } from "./team.schema";
import type {
  TeamActivityDTO,
  TeamMemberDetailDTO,
  TeamMemberProjectDTO,
  TeamMemberSummaryDTO,
  TeamOverviewStats,
} from "./team.types";

/**
 * Team service (PRD #14 §144, §157).
 *
 * Membership is the company's access control surface, so three rules are
 * enforced here and nowhere else:
 *
 *   1. The company never loses its last active Owner (PRD #14 §93).
 *   2. Only an Owner may create another Owner (PRD #14 §95, §96).
 *   3. Removing access takes effect at once, by revoking the sessions that
 *      carry it, not by waiting for them to expire (PRD #14 §242, §243).
 */

const MODULE = "team" as const;
const ENTITY = "CompanyMember";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listMembers(context: UserContext, query: TeamListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "team.member.view");

  const { rows, total, projectCounts } = await repository.listMembers(context, query);
  const showSecurity = can(context, "team.member.security_metadata.view");

  return {
    data: rows.map((row) => toSummaryDTO(row, projectCounts.get(row.id) ?? 0, showSecurity)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getMember(
  context: UserContext,
  memberId: string,
): Promise<TeamMemberDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "team.member.view");

  // A member outside the reader's scope answers "not found", so the response
  // cannot confirm that somebody they may not see works here (PRD #14 §160).
  const member = assertFound(await repository.findMemberInScope(context, memberId));

  const [counts, guards] = await Promise.all([
    repository.visibleProjectCounts(context, [memberId]),
    repository.membershipGuards(context, memberId),
  ]);

  return toDetailDTO(context, member, counts.get(memberId) ?? 0, guards);
}

export async function getTeamOverview(context: UserContext): Promise<TeamOverviewStats> {
  assertModule(context, MODULE);
  assertPermission(context, "team.view");
  return repository.teamOverviewStats(context);
}

export async function listMemberProjects(
  context: UserContext,
  memberId: string,
): Promise<TeamMemberProjectDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "team.member.view");
  assertPermission(context, "project.view");
  assertFound(await repository.findMemberInScope(context, memberId));

  const { memberships, managed } = await repository.listMemberProjects(context, memberId);

  const rows: TeamMemberProjectDTO[] = memberships.map((entry) => ({
    id: entry.project.id,
    code: entry.project.code,
    name: entry.project.name,
    projectRole: entry.projectRole,
    status: entry.project.status,
    isManager: false,
  }));

  for (const project of managed) {
    const existing = rows.find((row) => row.id === project.id);
    if (existing) {
      existing.isManager = true;
      continue;
    }
    rows.push({
      id: project.id,
      code: project.code,
      name: project.name,
      projectRole: "Project Manager",
      status: project.status,
      isManager: true,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listMemberActivity(
  context: UserContext,
  memberId: string,
  options: { page: number; limit: number },
) {
  assertModule(context, MODULE);
  assertPermission(context, "team.activity.view");
  assertFound(await repository.findMemberInScope(context, memberId));

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: MODULE,
    // Membership changes *about* this person, and department changes they were
    // the subject of. Authentication events are not user-visible Team activity
    // (PRD #14 §57).
    OR: [
      { entityType: ENTITY, entityId: memberId },
      { metadata: { path: ["memberId"], equals: memberId } },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: skipFor(options.page, options.limit),
      take: options.limit,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  const data: TeamActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: paginationMeta(total, options.page, options.limit) };
}

/* -------------------------------------------------------------------------- */
/* Membership writes                                                           */
/* -------------------------------------------------------------------------- */

export async function updateMember(
  context: UserContext,
  memberId: string,
  input: UpdateMemberInput,
): Promise<TeamMemberDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "team.member.update");

  const existing = assertFound(await repository.findMemberInScope(context, memberId));

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This member was updated by another user. Refresh and review the latest changes.",
    );
  }

  const roleChanged = input.roleId !== existing.role.id;
  const departmentChanged = (input.departmentId ?? null) !== (existing.department?.id ?? null);

  const nextRole = roleChanged ? await validateRole(context, input.roleId) : existing.role;
  const nextDepartment = departmentChanged
    ? await validateDepartment(context, input.departmentId)
    : existing.department;

  if (roleChanged) {
    assertPermission(context, "team.member.role.assign");
    await assertRoleChangeAllowed(context, existing, nextRole.key);
  }
  if (departmentChanged) assertPermission(context, "team.member.department.assign");

  await prisma.$transaction(async (tx) => {
    await tx.companyMember.update({
      where: { id: memberId },
      data: {
        jobTitle: input.jobTitle ?? null,
        roleId: nextRole.id,
        departmentId: nextDepartment?.id ?? null,
      },
    });

    // Specific events rather than one opaque update, because "their role
    // changed" is the entry somebody will be looking for later (PRD #14 §326).
    if (roleChanged) {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: memberId,
        action: "MEMBER_ROLE_CHANGED",
        message: `changed the role from ${existing.role.name} to ${nextRole.name}`,
        metadata: {
          memberId,
          ...(changeMetadata({
            roleKey: { from: existing.role.key, to: nextRole.key },
          }) as object),
        } as Prisma.InputJsonValue,
      });
    }

    if (departmentChanged) {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: memberId,
        action: "MEMBER_DEPARTMENT_CHANGED",
        message: nextDepartment
          ? `moved them to ${nextDepartment.name}`
          : "removed them from their department",
        metadata: {
          memberId,
          ...(changeMetadata({
            departmentId: {
              from: existing.department?.id ?? null,
              to: nextDepartment?.id ?? null,
            },
          }) as object),
        } as Prisma.InputJsonValue,
      });
    }

    if (!roleChanged && !departmentChanged) {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: memberId,
        action: "MEMBER_UPDATED",
        message: "updated their membership",
        metadata: { memberId } as Prisma.InputJsonValue,
      });
    }
  });

  return getMember(context, memberId);
}

export async function deactivateMember(context: UserContext, memberId: string): Promise<void> {
  await changeMembershipStatus(context, memberId, "INACTIVE", {
    permission: "team.member.deactivate",
    action: "MEMBER_DEACTIVATED",
    message: "deactivated their company access",
    requireProjectHandover: true,
  });
}

export async function suspendMember(context: UserContext, memberId: string): Promise<void> {
  await changeMembershipStatus(context, memberId, "SUSPENDED", {
    permission: "team.member.suspend",
    action: "MEMBER_SUSPENDED",
    message: "suspended their company access",
  });
}

export async function reactivateMember(context: UserContext, memberId: string): Promise<void> {
  await changeMembershipStatus(context, memberId, "ACTIVE", {
    permission: "team.member.reactivate",
    action: "MEMBER_REACTIVATED",
    message: "restored their company access",
  });
}

export async function unsuspendMember(context: UserContext, memberId: string): Promise<void> {
  await changeMembershipStatus(context, memberId, "ACTIVE", {
    permission: "team.member.unsuspend",
    action: "MEMBER_REACTIVATED",
    message: "lifted their suspension",
    from: ["SUSPENDED"],
  });
}

type StatusChangeOptions = {
  permission: Parameters<typeof assertPermission>[1];
  action: string;
  message: string;
  from?: MembershipStatus[];
  /** Blocks removal while the member still manages an active project. */
  requireProjectHandover?: boolean;
};

async function changeMembershipStatus(
  context: UserContext,
  memberId: string,
  next: MembershipStatus,
  options: StatusChangeOptions,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, options.permission);

  const existing = assertFound(await repository.findMemberInScope(context, memberId));

  // A person removing their own access could lock themselves out of the
  // company by accident (PRD #14 §167).
  if (memberId === context.membershipId && next !== "ACTIVE") {
    throw new AccessError("CONFLICT", "You cannot change your own company access here.");
  }

  if (options.from && !options.from.includes(existing.status)) {
    throw new AccessError("CONFLICT", `This member is ${existing.status.toLowerCase()}.`);
  }
  if (existing.status === next) {
    throw new AccessError("CONFLICT", `This member is already ${next.toLowerCase()}.`);
  }
  if (!canTransitionMembershipStatus(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A membership cannot move from ${existing.status} to ${next}.`,
    );
  }

  const guards = await repository.membershipGuards(context, memberId);

  // The company must keep at least one active Owner (PRD #14 §93, §163).
  if (next !== "ACTIVE" && guards.lastActiveOwner) {
    throw new AccessError(
      "CONFLICT",
      "Assign another active Owner before changing this member's access.",
    );
  }

  // An active project would otherwise be left without a manager (PRD #14 §102).
  if (options.requireProjectHandover && guards.managedActiveProjects > 0) {
    throw new AccessError(
      "CONFLICT",
      `They manage ${guards.managedActiveProjects} active project${
        guards.managedActiveProjects === 1 ? "" : "s"
      }. Reassign those before removing their access.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.companyMember.update({
      where: { id: memberId },
      data: {
        status: next,
        deactivatedAt: next === "ACTIVE" ? null : new Date(),
        deactivatedByMemberId: next === "ACTIVE" ? null : context.membershipId,
      },
    });

    // Access ends now, not when a session happens to expire. The session rows
    // carry company access, so deleting them is the revocation
    // (PRD #14 §242, §243).
    if (next !== "ACTIVE") {
      await tx.session.deleteMany({ where: { membershipId: memberId } });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: memberId,
      action: options.action,
      message: options.message,
      metadata: {
        memberId,
        ...(changeMetadata({ status: { from: existing.status, to: next } }) as object),
      } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function validateRole(context: UserContext, roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, key: true, name: true },
  });
  if (!role) throw new AccessError("VALIDATION_ERROR", "That role does not exist.");
  void context;
  return role;
}

async function validateDepartment(context: UserContext, departmentId: string | undefined) {
  if (!departmentId) return null;

  const department = await prisma.department.findFirst({
    where: { id: departmentId, companyId: context.companyId },
    select: { id: true, name: true, status: true, archivedAt: true },
  });
  if (!department) throw new AccessError("VALIDATION_ERROR", "That department does not exist.");
  if (department.status === "ARCHIVED" || department.archivedAt !== null) {
    throw new AccessError("VALIDATION_ERROR", "That department is archived.");
  }
  return { id: department.id, name: department.name };
}

/**
 * Role-change guards (PRD #14 §93–§96, §164).
 *
 * Two separate rules: creating an Owner needs its own grant, and the last
 * active Owner cannot be demoted out of existence.
 */
async function assertRoleChangeAllowed(
  context: UserContext,
  existing: repository.TeamMemberDetailRow,
  nextRoleKey: string,
): Promise<void> {
  if (nextRoleKey === "OWNER") assertPermission(context, "team.owner.assign");

  if (existing.role.key === "OWNER" && nextRoleKey !== "OWNER") {
    const owners = await repository.activeOwnerCount(context.companyId);
    if (existing.status === "ACTIVE" && owners <= 1) {
      throw new AccessError(
        "CONFLICT",
        "Assign another active Owner before changing this member's role.",
      );
    }
  }

  // Promoting yourself is a decision somebody else should take (PRD #14 §168).
  if (existing.id === context.membershipId && nextRoleKey !== existing.role.key) {
    throw new AccessError("CONFLICT", "Another manager must change your role.");
  }
}

/* -------------------------------------------------------------------------- */
/* DTO mapping                                                                 */
/* -------------------------------------------------------------------------- */

export function toSummaryDTO(
  row: repository.TeamMemberRow,
  projectCount: number,
  showSecurity: boolean,
): TeamMemberSummaryDTO {
  return {
    id: row.id,
    userId: row.userId,
    name: {
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      fullName: `${row.user.firstName} ${row.user.lastName}`,
    },
    email: row.user.email,
    avatarUrl: row.user.avatarUrl,
    role: row.role,
    department: row.department,
    jobTitle: row.jobTitle,
    status: row.status,
    projectCount,
    // Last login is security metadata, not directory data (PRD #14 §49, §234).
    lastLoginAt: showSecurity ? (row.user.lastLoginAt?.toISOString() ?? null) : null,
    joinedAt: row.joinedAt?.toISOString() ?? null,
  };
}

function toDetailDTO(
  context: UserContext,
  row: repository.TeamMemberDetailRow,
  visibleProjects: number,
  guards: { managedActiveProjects: number; openAssignedTasks: number; lastActiveOwner: boolean },
): TeamMemberDetailDTO {
  const self = row.id === context.membershipId;
  const showSecurity = can(context, "team.member.security_metadata.view");

  return {
    id: row.id,
    userId: row.userId,
    updatedAt: row.updatedAt.toISOString(),
    profile: {
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      fullName: `${row.user.firstName} ${row.user.lastName}`,
      email: row.user.email,
      phone: row.user.phone,
      avatarUrl: row.user.avatarUrl,
    },
    membership: {
      role: row.role,
      department: row.department,
      jobTitle: row.jobTitle,
      status: row.status,
      joinedAt: row.joinedAt?.toISOString() ?? null,
      invitedAt: row.invitedAt?.toISOString() ?? null,
      deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    },
    counts: { visibleProjects },
    ...(showSecurity
      ? { securityMetadata: { lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null } }
      : {}),
    capabilities: {
      canEditMembership: can(context, "team.member.update"),
      canAssignRole: can(context, "team.member.role.assign") && !self,
      canAssignDepartment: can(context, "team.member.department.assign"),
      canDeactivate:
        can(context, "team.member.deactivate") &&
        !self &&
        row.status !== "INACTIVE" &&
        !guards.lastActiveOwner,
      canReactivate: can(context, "team.member.reactivate") && row.status === "INACTIVE",
      canSuspend:
        can(context, "team.member.suspend") &&
        !self &&
        row.status === "ACTIVE" &&
        !guards.lastActiveOwner,
      canUnsuspend: can(context, "team.member.unsuspend") && row.status === "SUSPENDED",
      canViewActivity: can(context, "team.activity.view"),
    },
    guards,
  };
}
