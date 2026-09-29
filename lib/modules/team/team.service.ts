import { isMembershipRoleKey } from "@/config/roles";
import { setTemporaryPassword } from "@/lib/auth/identity";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "@/lib/auth/temporary-password";
import { revokeSessions } from "@/lib/auth/session-store";
import { Prisma, type MembershipStatus } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { invalidateRequestScope } from "@/lib/core/observability/request-scope";
import type { UserContext } from "@/lib/context/types";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { pageWindow, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
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
import type { PlacementDoor } from "./team.placement";

/**
 * Team service (PRD #14 §144, §157).
 *
 * Membership is the company's access control surface, so three rules are
 * enforced here and nowhere else:
 *
 *   1. The company never loses its last active Owner (PRD #14 §93).
 *   2. Only an Owner may create another Owner — or demote, suspend, remove or
 *      restore one (PRD #14 §95, §96, PRD #47 §57).
 *   3. Removing access takes effect at once, by revoking the sessions that
 *      carry it, not by waiting for them to expire (PRD #14 §242, §243).
 */

const MODULE = "team" as const;
const ENTITY = "CompanyMember";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

export async function listMembers(context: UserContext, query: TeamListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "team.member.view");

  const showSecurity = can(context, "team.member.security_metadata.view");
  // Ordering by last login would reveal it to a reader who may not see it: that sort is theirs only (AUD-08 §5, DT-09).
  const sorted = query.sort === "last-login-desc" && !showSecurity ? { ...query, sort: "name-asc" as const } : query;
  const { rows, window, projectCounts } = await repository.listMembers(context, sorted);

  return {
    data: rows.map((row) => toSummaryDTO(row, projectCounts.get(row.id) ?? 0, showSecurity)),
    pagination: window,
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

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "team.activity.list",
    async (tx) => {
      const window = pageWindow(await tx.activity.count({ where }), options.page, options.limit);
      const rows = await tx.activity.findMany({
        where,
        orderBy: withTieBreaker({ createdAt: "desc" }),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: {
          id: true,
          action: true,
          message: true,
          createdAt: true,
          actorMemberId: true,
          actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const data: TeamActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    actorMemberId: row.actorMemberId,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: window };
}

/* -------------------------------------------------------------------------- */
/* Membership writes                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A membership's role, department and title (PRD #14). Moving somebody's
 * department is also moving their place in that department's team, which the
 * organization keeps: the caller hands in its door (`placeMembership`, ADR 0003).
 */
export async function updateMember(
  context: UserContext,
  memberId: string,
  input: UpdateMemberInput,
  options: { placement: PlacementDoor },
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
  // Absent is unchanged (AUD-09 §4, FV-05).
  const departmentChanged = input.departmentId !== undefined && (input.departmentId ?? null) !== (existing.department?.id ?? null);
  const titleChanged = input.jobTitle !== undefined && (input.jobTitle ?? null) !== (existing.jobTitle ?? null);

  const nextRole = roleChanged ? await validateRole(context, input.roleId) : existing.role;
  const nextDepartment = departmentChanged
    ? await validateDepartment(context, input.departmentId ?? undefined)
    : existing.department;

  if (roleChanged) {
    assertPermission(context, "team.member.role.assign");
    await assertRoleChangeAllowed(context, existing, nextRole.key);
  }
  if (departmentChanged) assertPermission(context, "team.member.department.assign");

  await prisma.$transaction(async (tx) => {
    if (roleChanged) {
      await assertAnotherActiveOwner(tx, context.companyId, memberId, "role", nextRole.key);
    }

    await tx.companyMember.update({
      where: { id: memberId },
      data: {
        jobTitle: input.jobTitle === undefined ? existing.jobTitle : input.jobTitle,
        roleId: nextRole.id,
        departmentId: nextDepartment?.id ?? null,
      },
    });
    // A department or a title is a placement: the organization and HR keep their records true to it (ADR 0003, ADR 0004).
    if (departmentChanged || titleChanged) {
      await options.placement(tx, {
        companyId: context.companyId,
        userId: existing.user.id,
        fromDepartmentId: existing.department?.id ?? null,
        toDepartmentId: nextDepartment?.id ?? null,
        actor: context,
      });
    }

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

    /*
     * A role change is what decides what somebody may do, so its policy is
     * CRITICAL and `required` — the evidence commits with the change
     * (PRD #28 §95, §136). The department move is recorded too, at INFO: it
     * shifts departmental scope, which is quieter but still an access change.
     */
    const label = `${existing.user.firstName} ${existing.user.lastName}`.trim();

    if (roleChanged) {
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.TEAM_MEMBER_ROLE_CHANGED,
          entity: { type: ENTITY, id: memberId, label },
          before: { roleKey: existing.role.key, roleName: existing.role.name },
          after: { roleKey: nextRole.key, roleName: nextRole.name },
        },
        { tx },
      );
    }

    if (departmentChanged) {
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.TEAM_MEMBER_DEPARTMENT_CHANGED,
          entity: { type: ENTITY, id: memberId, label },
          before: {
            departmentId: existing.department?.id ?? null,
            departmentName: existing.department?.name ?? null,
          },
          after: {
            departmentId: nextDepartment?.id ?? null,
            departmentName: nextDepartment?.name ?? null,
          },
        },
        { tx },
      );
    }
  });
  // A role or placement changed: nothing later in this request answers from before it (NAV-02 CTX-04).
  invalidateRequestScope();

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

/**
 * `INACTIVE → ACTIVE`, and nothing else (PRD #14 §109, PRD #47 §58).
 *
 * A suspension is lifted by `unsuspendMember`, and a pending invitation is
 * activated only by the invited person accepting it — never by an
 * administrator pressing Reactivate on somebody who has not agreed to join.
 */
export async function reactivateMember(context: UserContext, memberId: string): Promise<void> {
  await changeMembershipStatus(context, memberId, "ACTIVE", {
    permission: "team.member.reactivate",
    action: "MEMBER_REACTIVATED",
    message: "restored their company access",
    from: ["INACTIVE"],
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

/**
 * The statuses this path may move a membership to. `INVITED` is deliberately
 * excluded: it is where a membership starts, not somewhere it can be sent back
 * to, and the audit map below would otherwise need an entry that cannot occur.
 */
type ReachableMembershipStatus = Exclude<MembershipStatus, "INVITED">;

async function changeMembershipStatus(
  context: UserContext,
  memberId: string,
  next: ReachableMembershipStatus,
  options: StatusChangeOptions,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, options.permission);

  const existing = assertFound(await repository.findMemberInScope(context, memberId));

  // An Owner's access is the Owner grant's to change, in either direction.
  // The last-Owner rule alone is not enough: with two active Owners it never
  // fires, and an Admin could otherwise suspend one Owner or restore a removed
  // one (PRD #14 §95, §96, PRD #47 §57).
  if (existing.role.key === "OWNER") assertPermission(context, "team.owner.assign");
  // Group IT is group authority: only those who may give it may take it away.
  if (existing.role.key === "GROUP_IT") assertPermission(context, "team.group_role.assign");

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
    if (next !== "ACTIVE") {
      await assertAnotherActiveOwner(tx, context.companyId, memberId, "access");
    }

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
      await revokeSessions(tx, { membershipId: memberId, relocate: true });

      // A pending invitation is access waiting to be claimed. Removing the
      // membership it would activate withdraws the invitation with it, so the
      // link cannot quietly undo the deactivation (PRD #47 §58).
      await tx.companyInvite.updateMany({
        where: { companyId: context.companyId, companyMemberId: memberId, status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
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

    /*
     * Access control is the category a compliance reviewer reads first, and
     * these three policies are `required` — so the evidence commits inside the
     * same transaction as the status change, or neither happens
     * (PRD #28 §95, §136).
     */
    await recordUserAction(
      context,
      {
        actionKey: STATUS_AUDIT_ACTION[next],
        entity: {
          type: ENTITY,
          id: memberId,
          label: `${existing.user.firstName} ${existing.user.lastName}`.trim(),
        },
        before: { status: existing.status },
        after: { status: next },
      },
      { tx },
    );
  });
  invalidateRequestScope();
}

/** Which audit action a membership transition records (PRD #28 §95). */
const STATUS_AUDIT_ACTION: Record<
  ReachableMembershipStatus,
  (typeof AuditAction)[keyof typeof AuditAction]
> = {
  ACTIVE: AuditAction.TEAM_MEMBER_ACTIVATED,
  INACTIVE: AuditAction.TEAM_MEMBER_DEACTIVATED,
  SUSPENDED: AuditAction.TEAM_MEMBER_SUSPENDED,
};

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function validateRole(context: UserContext, roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, key: true, name: true },
  });
  if (!role) throw new AccessError("VALIDATION_ERROR", "That role does not exist.");
  // Platform access is held outside every company, never as a membership (E-06 §19).
  if (!isMembershipRoleKey(role.key)) {
    throw new AccessError("VALIDATION_ERROR", "That role cannot be held in a company.");
  }
  void context;
  return role;
}

async function validateDepartment(context: UserContext, departmentId: string | undefined) {
  if (!departmentId) return null;

  const department = await prisma.department.findFirst({
    where: { id: departmentId, companyId: context.companyId },
    select: { id: true, name: true, status: true, archivedAt: true, groupDepartment: { select: { status: true } } },
  });
  if (!department) throw new AccessError("VALIDATION_ERROR", "That department does not exist.");
  // An inactive department takes nobody new (E-13 §89, §90).
  if (department.status !== "ACTIVE" || department.archivedAt !== null || (department.groupDepartment && department.groupDepartment.status !== "ACTIVE")) {
    throw new AccessError("VALIDATION_ERROR", "That department is not active.");
  }
  return { id: department.id, name: department.name };
}

/**
 * Role-change guards (PRD #14 §93–§96, §164, PRD #47 §57).
 *
 * Two separate rules: the Owner role is the Owner grant's to give *and* to
 * take away, and the last active Owner cannot be demoted out of existence.
 * The count below answers early with a friendly refusal; the binding check is
 * repeated under a lock inside the write (`assertAnotherActiveOwner`).
 */
async function assertRoleChangeAllowed(
  context: UserContext,
  existing: repository.TeamMemberDetailRow,
  nextRoleKey: string,
): Promise<void> {
  if (nextRoleKey === "OWNER" || existing.role.key === "OWNER") {
    assertPermission(context, "team.owner.assign");
  }
  if (nextRoleKey === "GROUP_IT" || existing.role.key === "GROUP_IT") {
    assertPermission(context, "team.group_role.assign");
  }

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

/**
 * The last-Owner and last-CEO rule, evaluated where it cannot race (PRD #14
 * §93, PRD #47 §57, CEO Users & Roles §20).
 *
 * A count taken before the transaction lets two administrators each see two
 * Owners and each demote one, leaving none. The company row is locked first,
 * so changes that could remove an Owner or a CEO run one at a time per
 * company, and the member is re-read under that lock — the second writer
 * counts what the first one committed.
 *
 * The CEO administers the company's users, so a company that loses its last
 * active CEO has nobody left inside it to recover; the Platform console
 * remains the recovery path. `nextRoleKey` is the role the member keeps after
 * the change (absent when their access is ending).
 */
const PROTECTED_ROLE_LABELS: Record<string, string> = { OWNER: "Owner", CEO: "CEO" };

async function assertAnotherActiveOwner(
  tx: Prisma.TransactionClient,
  companyId: string,
  memberId: string,
  change: "role" | "access",
  nextRoleKey?: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "companies" WHERE id = ${companyId} FOR UPDATE`;

  const member = await tx.companyMember.findFirst({
    where: { id: memberId, companyId },
    select: { status: true, role: { select: { key: true } } },
  });
  const label = member ? PROTECTED_ROLE_LABELS[member.role.key] : undefined;
  if (member?.status !== "ACTIVE" || !label || member.role.key === nextRoleKey) return;

  const others = await tx.companyMember.count({
    where: { companyId, id: { not: memberId }, status: "ACTIVE", role: { key: member.role.key } },
  });
  if (others === 0) {
    throw new AccessError(
      "CONFLICT",
      change === "role"
        ? `Assign another active ${label} before changing this member's role.`
        : `Assign another active ${label} before changing this member's access.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* DTO mapping                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What an invited, not-yet-joined membership may show (PRD #47 §59).
 *
 * The invitation was addressed to an email, and until that person accepts, the
 * address is all this company has been given. The account behind it belongs to
 * NESTO, not to the company: its name, photo, phone and last sign-in describe
 * somebody's life elsewhere and must not reach whoever typed their address into
 * an invite form.
 */
function invitedIdentity(row: { status: string; user: { email: string | null; username: string } }) {
  if (row.status !== "INVITED") return null;
  // The address if the company has one, the username otherwise — either way an
  // identifier the company already knows, never the person's real name.
  const label = row.user.email ?? row.user.username;
  return { firstName: label, lastName: "", fullName: label };
}

export function toSummaryDTO(
  row: repository.TeamMemberRow,
  projectCount: number,
  showSecurity: boolean,
): TeamMemberSummaryDTO {
  const invited = invitedIdentity(row);

  return {
    id: row.id,
    userId: row.userId,
    name: invited ?? {
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      fullName: `${row.user.firstName} ${row.user.lastName}`,
    },
    email: row.user.email,
    avatarUrl: invited ? null : row.user.avatarUrl,
    role: row.role,
    department: row.department,
    jobTitle: row.jobTitle,
    status: row.status,
    projectCount,
    // Last login is security metadata, not directory data (PRD #14 §49, §234),
    // and an invitee's is not this company's to read at all (PRD #47 §59).
    lastLoginAt: showSecurity && !invited ? (row.user.lastLoginAt?.toISOString() ?? null) : null,
    joinedAt: row.joinedAt?.toISOString() ?? null,
  };
}

function toDetailDTO(
  context: UserContext,
  row: repository.TeamMemberDetailRow,
  visibleProjects: number,
  guards: { managedActiveProjects: number; openAssignedTasks: number; lastActiveOwner: boolean; lastActiveRole: "OWNER" | "CEO" | null },
): TeamMemberDetailDTO {
  const self = row.id === context.membershipId;
  const showSecurity = can(context, "team.member.security_metadata.view");
  const invited = invitedIdentity(row);
  // An Owner's role and access are only offered to somebody who may change
  // them; the service enforces the same grant (PRD #47 §57).
  const ownerLocked =
    (row.role.key === "OWNER" && !can(context, "team.owner.assign")) ||
    (row.role.key === "GROUP_IT" && !can(context, "team.group_role.assign"));

  return {
    id: row.id,
    userId: row.userId,
    // The person behind the membership, whose group-wide profile is at /people (E-01, ADR 0002).
    personId: invited ? null : row.user.personProfileId,
    updatedAt: row.updatedAt.toISOString(),
    profile: {
      ...(invited ?? {
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        fullName: `${row.user.firstName} ${row.user.lastName}`,
      }),
      email: row.user.email,
      phone: invited ? null : row.user.phone,
      avatarUrl: invited ? null : row.user.avatarUrl,
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
      ? {
          securityMetadata: {
            lastLoginAt: invited ? null : (row.user.lastLoginAt?.toISOString() ?? null),
          },
        }
      : {}),
    capabilities: {
      canEditMembership: can(context, "team.member.update"),
      canAssignRole: can(context, "team.member.role.assign") && !self && !ownerLocked,
      canAssignDepartment: can(context, "team.member.department.assign"),
      canDeactivate:
        can(context, "team.member.deactivate") &&
        !self &&
        !ownerLocked &&
        row.status !== "INACTIVE" &&
        !guards.lastActiveOwner,
      canReactivate:
        can(context, "team.member.reactivate") && !ownerLocked && row.status === "INACTIVE",
      canSuspend:
        can(context, "team.member.suspend") &&
        !self &&
        !ownerLocked &&
        row.status === "ACTIVE" &&
        !guards.lastActiveOwner,
      canUnsuspend:
        can(context, "team.member.unsuspend") && !ownerLocked && row.status === "SUSPENDED",
      canViewActivity: can(context, "team.activity.view"),
    },
    guards,
  };
}

/* -------------------------------------------------------------------------- */
/* Password reset by an administrator                                          */
/* -------------------------------------------------------------------------- */

export type PasswordResetResult = {
  username: string;
  temporaryPassword: string;
  expiresAt: Date;
  sessionsRevoked: number;
};

/**
 * Give somebody a way back into an account they are locked out of
 * (PRD #50 §20-§23).
 *
 * This is the whole of account recovery in V0.1: there is no self-service
 * reset, no link in an inbox, and no mail transport involved — an
 * administrator issues a temporary password and passes it on however that
 * organisation already passes such things on (§18, §268).
 *
 * Three things happen together or not at all. The password is replaced, the
 * account is held at the change screen until its holder chooses their own, and
 * every existing session is revoked: whoever was signed in as this account —
 * including whoever the reset is protecting against — stops being signed in.
 *
 * The temporary password is returned to the caller **once**. It is not stored
 * in readable form, not written to the audit trail, and not logged.
 */
export async function resetMemberPassword(
  context: UserContext,
  memberId: string,
): Promise<PasswordResetResult> {
  assertModule(context, "team");
  assertPermission(context, "team.member.password.reset");

  const member = assertFound(
    await prisma.companyMember.findFirst({
      where: { id: memberId, companyId: context.companyId },
      select: { id: true, userId: true, user: { select: { username: true } } },
    }),
  );

  // Resetting your own password is the change-password flow, which asks for
  // the current one. Going through here instead would let somebody holding an
  // unlocked screen take the account over without knowing it (§22).
  if (member.id === context.membershipId) {
    throw new AccessError("VALIDATION_ERROR", "Change your own password from your profile instead.", {
      code: "SELF_RESET",
    });
  }

  const temporaryPassword = generateTemporaryPassword();
  const expiresAt = temporaryPasswordExpiry();

  const sessionsRevoked = await prisma.$transaction(async (tx) => {
    // Auth owns the credential and what forces its replacement (PRD #48 §11).
    await setTemporaryPassword(tx, member.userId, temporaryPassword, expiresAt);
    const revoked = await revokeSessions(tx, { userId: member.userId });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.TEAM_MEMBER_PASSWORD_RESET,
        entity: { type: ENTITY, id: member.id, label: member.user.username },
        after: {
          username: member.user.username,
          mustChangePassword: true,
          sessionsRevoked: revoked,
          expiresAt: expiresAt.toISOString(),
        },
      },
      { tx },
    );

    await recordActivity(tx, context, {
      module: "team",
      entityType: "CompanyMember",
      entityId: member.id,
      action: "MEMBER_PASSWORD_RESET",
      message: "issued a temporary password",
    });

    return revoked;
  });

  return { username: member.user.username, temporaryPassword, expiresAt, sessionsRevoked };
}
