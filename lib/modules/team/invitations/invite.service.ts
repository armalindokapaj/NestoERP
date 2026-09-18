import { isMembershipRoleKey } from "@/config/roles";
import { createUserForInvite } from "@/lib/auth/identity";
import { recordActorActivity } from "@/lib/modules/shared/activity";
import { Prisma, type CompanyInviteStatus } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { sendMail } from "@/lib/mail";
import { hitThrottle, retryAfterMinutes } from "@/lib/core/security/throttle";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordAuditEvent, recordUserAction } from "@/lib/core/audit/audit.service";
import type { PlacementDoor } from "../team.placement";
import type { InviteMemberInput } from "../team.schema";
import type { InvitationDTO } from "../team.types";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteUrl,
  isInviteExpired,
  normalizeEmail,
} from "./invite.token";

/**
 * Invitations (PRD #14 §58–§80, §158).
 *
 * The shape of this flow is dictated by one requirement: a failed email must
 * not corrupt the invitation. So the membership and the invite row are written
 * and committed first, and delivery is attempted afterwards — a provider outage
 * leaves a valid invitation somebody can resend, not a half-created member
 * (PRD #14 §71, §72).
 */

const MODULE = "team" as const;

export type InviteResult = {
  inviteId: string;
  email: string;
  /** False when the invitation exists but the message could not be sent. */
  delivered: boolean;
  /** Where the message got to: SUPPRESSED is a staging address outside the allowlist. */
  deliveryStatus: "SENT" | "FAILED" | "SUPPRESSED";
  /** Development only, so the flow can be walked without a mail provider. */
  inviteUrl?: string;
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listInvitations(
  context: UserContext,
  options: { status?: CompanyInviteStatus } = {},
): Promise<InvitationDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "team.invitation.view");

  const rows = await prisma.companyInvite.findMany({
    where: { companyId: context.companyId, ...(options.status ? { status: options.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const [roles, departments, inviters, deliveries] = await Promise.all([
    prisma.role.findMany({ select: { id: true, name: true } }),
    prisma.department.findMany({
      where: { companyId: context.companyId },
      select: { id: true, name: true },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    }),
    // Newest first, so the first one seen per invitation is its latest message.
    prisma.mailDelivery.findMany({
      where: { entityType: "CompanyInvite", entityId: { in: rows.map((row) => row.id) } },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, status: true, errorCode: true, createdAt: true },
    }),
  ]);

  const deliveryByInvite = new Map<string, (typeof deliveries)[number]>();
  for (const delivery of deliveries) {
    if (delivery.entityId && !deliveryByInvite.has(delivery.entityId)) {
      deliveryByInvite.set(delivery.entityId, delivery);
    }
  }

  const roleById = new Map(roles.map((role) => [role.id, role]));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const inviterById = new Map(
    inviters.map((member) => [member.id, `${member.user.firstName} ${member.user.lastName}`]),
  );

  const now = new Date();

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: null,
    role: roleById.get(row.roleId) ?? { id: row.roleId, name: "Unknown role" },
    department: row.departmentId ? (departmentById.get(row.departmentId) ?? null) : null,
    jobTitle: row.jobTitle,
    invitedBy: inviterById.get(row.createdByMemberId) ?? null,
    invitedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    // Derived, so a row nobody has swept still reads as expired (PRD #14 §236).
    status:
      row.status === "PENDING" && isInviteExpired(row.expiresAt, now) ? "EXPIRED" : row.status,
    delivery: (() => {
      const delivery = deliveryByInvite.get(row.id);
      return delivery
        ? { status: delivery.status, errorCode: delivery.errorCode, at: delivery.createdAt.toISOString() }
        : null;
    })(),
  }));
}

/* -------------------------------------------------------------------------- */
/* Invite                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The grants an invitation needs, and the role and department it names
 * (PRD #14 §61, §96, PRD #47 §58).
 *
 * Shared by the first invite and every resend: a resend issues a fresh
 * credential for the same role, so it must be exactly as authorised as sending
 * the invitation in the first place — an Admin cannot revive an expired Owner
 * invitation that only an Owner could have sent.
 */
async function resolveInviteGrants(
  context: UserContext,
  roleId: string,
  departmentId: string | null | undefined,
) {
  assertPermission(context, "team.member.invite");
  assertPermission(context, "team.member.role.assign");

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, key: true, name: true },
  });
  if (!role) throw new AccessError("VALIDATION_ERROR", "That role does not exist.");
  // Platform access is held outside every company, never as a membership (E-06 §19).
  if (!isMembershipRoleKey(role.key)) {
    throw new AccessError("VALIDATION_ERROR", "That role cannot be held in a company.");
  }
  // Only an Owner may create another Owner (PRD #14 §96).
  if (role.key === "OWNER") assertPermission(context, "team.owner.assign");

  const department = departmentId
    ? await prisma.department.findFirst({
        where: { id: departmentId, companyId: context.companyId, status: "ACTIVE", OR: [{ groupDepartmentId: null }, { groupDepartment: { status: "ACTIVE" } }] },
        select: { id: true },
      })
    : null;
  // An inactive department takes nobody new (E-13 §89, §90).
  if (departmentId && !department) {
    throw new AccessError("VALIDATION_ERROR", "That department does not exist or is not active.");
  }
  if (department) assertPermission(context, "team.member.department.assign");

  return { role, department };
}

export async function inviteMember(
  context: UserContext,
  input: InviteMemberInput,
): Promise<InviteResult> {
  assertModule(context, MODULE);

  const email = normalizeEmail(input.email);
  const { role, department } = await resolveInviteGrants(context, input.roleId, input.departmentId);

  /*
   * Whether the address already has a NESTO account — and whether that account
   * is active — is not this company's business, so neither changes the answer
   * (PRD #47 §59). A disabled account is still refused where it matters: it
   * cannot sign in, and acceptance checks the account again (PRD #14 §320).
   */
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  const existingMembership = user
    ? await prisma.companyMember.findFirst({
        where: { companyId: context.companyId, userId: user.id },
        select: { id: true, status: true },
      })
    : null;

  // Each existing state has its own answer, because "already a member" and
  // "suspended" need different next actions (PRD #14 §63, §161).
  if (existingMembership) {
    if (existingMembership.status === "ACTIVE") {
      throw new AccessError("CONFLICT", "That person is already a member of this company.");
    }
    if (existingMembership.status === "SUSPENDED") {
      throw new AccessError(
        "CONFLICT",
        "That membership is suspended. Lift the suspension instead of sending a new invitation.",
      );
    }
    if (existingMembership.status === "INACTIVE") {
      throw new AccessError(
        "CONFLICT",
        "That membership is inactive. Reactivate it instead of sending a new invitation.",
      );
    }
  }

  const pending = await prisma.companyInvite.findFirst({
    where: { companyId: context.companyId, email, status: "PENDING" },
    select: { id: true, expiresAt: true },
  });
  if (pending && !isInviteExpired(pending.expiresAt)) {
    throw new AccessError(
      "CONFLICT",
      "An invitation is already pending for that address. Resend it instead.",
    );
  }

  const token = generateInviteToken();
  const created = await prisma.$transaction(async (tx) => {
    // A stale pending invite for the same address is retired, so only one
    // token is ever valid at a time (PRD #14 §79, §136).
    await tx.companyInvite.updateMany({
      where: { companyId: context.companyId, email, status: "PENDING" },
      data: { status: "EXPIRED" },
    });

    // A re-invitation after the last one lapsed carries the new role and
    // department, so the pending row never describes the terms of an older,
    // retired invitation (PRD #47 §58).
    if (existingMembership) {
      await tx.companyMember.update({
        where: { id: existingMembership.id },
        data: {
          roleId: role.id,
          departmentId: department?.id ?? null,
          jobTitle: input.jobTitle ?? null,
          invitedAt: new Date(),
          invitedByMemberId: context.membershipId,
        },
      });
    }

    const membership =
      existingMembership ??
      (user
        ? await tx.companyMember.create({
            data: {
              companyId: context.companyId,
              userId: user.id,
              roleId: role.id,
              departmentId: department?.id ?? null,
              jobTitle: input.jobTitle ?? null,
              status: "INVITED",
              invitedAt: new Date(),
              invitedByMemberId: context.membershipId,
            },
            select: { id: true, status: true },
          })
        : null);

    const invite = await tx.companyInvite.create({
      data: {
        companyId: context.companyId,
        email,
        userId: user?.id ?? null,
        companyMemberId: membership?.id ?? null,
        roleId: role.id,
        departmentId: department?.id ?? null,
        jobTitle: input.jobTitle ?? null,
        tokenHash: hashInviteToken(token),
        status: "PENDING",
        expiresAt: inviteExpiry(),
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "CompanyInvite",
      entityId: invite.id,
      action: "MEMBER_INVITED",
      message: `invited ${email}`,
      // Never the token or its hash (PRD #14 §171).
      metadata: {
        email,
        roleId: role.id,
        departmentId: department?.id ?? null,
      } as Prisma.InputJsonValue,
    });

    /*
     * An invitation is the moment access is granted to somebody new, so the
     * policy is `required` and the evidence commits with the invite itself
     * (PRD #28 §95, §136). The token never appears here — the allowFields list
     * is email and roleKey (PRD #14 §171).
     */
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.TEAM_MEMBER_INVITED,
        entity: { type: "CompanyInvite", id: invite.id, label: email },
        after: { email, roleKey: role.key },
      },
      { tx },
    );

    return invite;
  });

  return deliverInvite(context, {
    inviteId: created.id,
    email,
    token,
    templateKey: "team.invitation",
  });
}

export async function resendInvitation(
  context: UserContext,
  inviteId: string,
): Promise<InviteResult> {
  assertModule(context, MODULE);
  assertPermission(context, "team.invitation.resend");

  const invite = assertFound(
    await prisma.companyInvite.findFirst({
      where: { id: inviteId, companyId: context.companyId },
      select: { id: true, email: true, status: true, roleId: true, departmentId: true, createdAt: true },
    }),
  );

  if (invite.status === "ACCEPTED") {
    throw new AccessError("CONFLICT", "That invitation has already been accepted.");
  }
  if (invite.status === "CANCELLED") {
    throw new AccessError("CONFLICT", "That invitation was cancelled.");
  }

  // Resending is issuing the invitation again, so it needs every grant the
  // original did — for the role it names today (PRD #47 §58).
  await resolveInviteGrants(context, invite.roleId, invite.departmentId);

  /*
   * An expired row that a newer invitation replaced is history, not something
   * to revive: bringing it back would put two live tokens, possibly for two
   * different roles, on one address (PRD #14 §79, PRD #47 §58).
   */
  const newer = await prisma.companyInvite.findFirst({
    where: {
      companyId: context.companyId,
      email: invite.email,
      id: { not: invite.id },
      createdAt: { gt: invite.createdAt },
    },
    select: { id: true },
  });
  if (newer) {
    throw new AccessError("CONFLICT", "A newer invitation exists for that address. Resend that one instead.");
  }

  // Somebody who has since joined, or whose membership was removed, is no
  // longer waiting on this invitation.
  const membership = await prisma.companyMember.findFirst({
    where: { companyId: context.companyId, user: { email: invite.email } },
    select: { status: true },
  });
  if (membership && membership.status !== "INVITED") {
    throw new AccessError("CONFLICT", "That invitation no longer applies. Send a new one if it is still needed.");
  }

  // Per invitation and per sender: a resend is an email to a real person, and
  // a button pressed in a loop must not become a way to flood one (PRD #38 §15).
  const allowance = await hitThrottle("INVITE_RESEND", { invite: inviteId, member: context.membershipId });
  if (!allowance.allowed) {
    throw new AccessError(
      "CONFLICT",
      `That invitation has been resent too often. Try again in ${retryAfterMinutes(allowance)} minutes.`,
    );
  }

  const token = generateInviteToken();

  await prisma.$transaction(async (tx) => {
    // The previous token stops working the moment a new one is issued, so two
    // valid links never exist for one membership (PRD #14 §79, §329).
    await tx.companyInvite.update({
      where: { id: inviteId },
      data: {
        tokenHash: hashInviteToken(token),
        status: "PENDING",
        expiresAt: inviteExpiry(),
        cancelledAt: null,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "CompanyInvite",
      entityId: inviteId,
      action: "MEMBER_INVITE_RESENT",
      message: `resent the invitation to ${invite.email}`,
      metadata: { email: invite.email } as Prisma.InputJsonValue,
    });
  });

  const result = await deliverInvite(context, {
    inviteId,
    email: invite.email,
    token,
    templateKey: "team.invitation_resend",
  });

  await recordUserAction(context, {
    actionKey: AuditAction.TEAM_INVITATION_RESENT,
    entity: { type: "CompanyInvite", id: inviteId, label: invite.email },
    after: { email: invite.email, deliveryStatus: result.deliveryStatus },
  });

  return result;
}

export async function cancelInvitation(context: UserContext, inviteId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "team.invitation.cancel");

  const invite = assertFound(
    await prisma.companyInvite.findFirst({
      where: { id: inviteId, companyId: context.companyId },
      select: { id: true, email: true, status: true, companyMemberId: true },
    }),
  );

  if (invite.status === "ACCEPTED") {
    throw new AccessError("CONFLICT", "That invitation has already been accepted.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.companyInvite.update({
      where: { id: inviteId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    // A membership that only ever existed to hold the invitation becomes
    // inactive rather than lingering as INVITED (PRD #14 §80).
    if (invite.companyMemberId) {
      await tx.companyMember.updateMany({
        where: { id: invite.companyMemberId, status: "INVITED" },
        data: { status: "INACTIVE" },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "CompanyInvite",
      entityId: inviteId,
      action: "MEMBER_INVITE_CANCELLED",
      message: `cancelled the invitation to ${invite.email}`,
      metadata: { email: invite.email } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.TEAM_INVITATION_CANCELLED,
        entity: { type: "CompanyInvite", id: inviteId, label: invite.email },
        before: { status: invite.status },
        after: { email: invite.email, status: "CANCELLED" },
      },
      { tx },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Acceptance                                                                  */
/* -------------------------------------------------------------------------- */

export type InvitePreview = {
  email: string;
  companyName: string;
  roleName: string;
  /** True when the address already has an account and must sign in first. */
  hasAccount: boolean;
};

/**
 * Reads an invitation for its landing page.
 *
 * Every failure answers the same way, so the page cannot be used to discover
 * which addresses have been invited (PRD #14 §240).
 */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const invite = await prisma.companyInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      email: true,
      status: true,
      expiresAt: true,
      roleId: true,
      company: { select: { name: true, status: true } },
    },
  });

  if (!invite) return null;
  if (invite.status !== "PENDING") return null;
  if (isInviteExpired(invite.expiresAt)) return null;
  // A suspended company cannot take on new people (PRD #14 §321).
  if (invite.company.status !== "ACTIVE") return null;

  const [role, user] = await Promise.all([
    prisma.role.findUnique({ where: { id: invite.roleId }, select: { name: true } }),
    prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } }),
  ]);

  return {
    email: invite.email,
    companyName: invite.company.name,
    roleName: role?.name ?? "Team member",
    hasAccount: Boolean(user),
  };
}

/**
 * What acceptance needs.
 *
 * The name and password are present only when the address has no account yet;
 * somebody who already has one signs in and is identified by
 * `options.authenticatedUserId` instead.
 */
export type AcceptInviteRequest = {
  token: string;
  firstName?: string;
  lastName?: string;
  password?: string;
};

export type AcceptResult = {
  userId: string;
  membershipId: string;
  companyId: string;
  /** The address the invitation was bound to, for the sign-in that follows. */
  email: string;
};

/**
 * Accepts an invitation (PRD #14 §73, §77, §328).
 *
 * One transaction: resolve or create the account, activate the membership, and
 * consume the token. Two people opening the same link race each other into the
 * same transaction and exactly one wins, because the second finds the invite no
 * longer PENDING (PRD #14 §328).
 *
 * Joining a company makes the account a person of its group (E-01 §219, ADR
 * 0002), and the person record is HR's. So the caller hands in HR's door
 * (`ensurePersonForUser`) and it runs in this transaction: Team does not import
 * HR, which would close a circle through Finance, Sales and Projects back to
 * Team (docs/domain-dependencies.md), and no caller can accept without it.
 */
export type PersonDoor = (
  tx: Prisma.TransactionClient,
  input: { userId: string; parentGroupId: string; jobTitle?: string | null },
) => Promise<string>;

export async function acceptInvite(
  input: AcceptInviteRequest,
  options: { authenticatedUserId?: string; personDoor: PersonDoor; placement: PlacementDoor },
): Promise<AcceptResult> {
  const tokenHash = hashInviteToken(input.token);

  return prisma.$transaction(async (tx) => {
    const invite = await tx.companyInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        companyId: true,
        email: true,
        roleId: true,
        departmentId: true,
        jobTitle: true,
        status: true,
        expiresAt: true,
        companyMemberId: true,
        company: { select: { status: true } },
      },
    });

    if (!invite || invite.status !== "PENDING" || isInviteExpired(invite.expiresAt)) {
      throw new AccessError("NOT_FOUND", "This invitation is invalid or has expired.");
    }
    if (invite.company.status !== "ACTIVE") {
      throw new AccessError("CONFLICT", "That company is not available.");
    }

    let user = await tx.user.findUnique({
      where: { email: invite.email },
      select: { id: true, status: true, firstName: true, lastName: true },
    });

    if (user) {
      // An account that already exists is claimed by signing in to it, never
      // by supplying a fresh password: otherwise anybody holding the link could
      // attach that person to a company without their knowledge
      // (PRD #14 §75, §76).
      if (!options.authenticatedUserId) {
        throw new AccessError(
          "UNAUTHENTICATED",
          "That address already has a NESTO account. Sign in to accept this invitation.",
        );
      }
      // The token is bound to its address: somebody signed in as another
      // person must not be able to claim it (PRD #14 §76).
      if (options.authenticatedUserId !== user.id) {
        throw new AccessError("FORBIDDEN", "This invitation belongs to a different account.");
      }
      if (user.status !== "ACTIVE") {
        throw new AccessError("CONFLICT", "That account is not active.");
      }
    } else {
      if (!input.password || !input.firstName || !input.lastName) {
        throw new AccessError(
          "VALIDATION_ERROR",
          "Choose a name and password to finish setting up your account.",
        );
      }
      user = await createUserForInvite(tx, {
        email: invite.email,
        firstName: input.firstName,
        lastName: input.lastName,
        password: input.password,
      });
    }

    /*
     * The terms are the invitation's, applied now (PRD #47 §58): the role,
     * department and title the inviter chose, not whatever an older invitation
     * left on the membership. A department deactivated in the meantime is
     * dropped rather than joined (E-13 §89).
     */
    const department = invite.departmentId
      ? await tx.department.findFirst({
          where: { id: invite.departmentId, companyId: invite.companyId, status: "ACTIVE", archivedAt: null, OR: [{ groupDepartmentId: null }, { groupDepartment: { status: "ACTIVE" } }] },
          select: { id: true },
        })
      : null;
    const terms = { roleId: invite.roleId, departmentId: department?.id ?? null, jobTitle: invite.jobTitle };

    const existing = invite.companyMemberId
      ? await tx.companyMember.findFirst({
          where: { id: invite.companyMemberId, companyId: invite.companyId },
          select: { id: true, userId: true, status: true },
        })
      : await tx.companyMember.findUnique({
          where: { companyId_userId: { companyId: invite.companyId, userId: user.id } },
          select: { id: true, userId: true, status: true },
        });

    let membership: { id: string };
    if (existing) {
      /*
       * Acceptance activates an invitation, and nothing else. A membership that
       * was deactivated or suspended after the link was sent stays that way —
       * the link is not a way round the decision (PRD #47 §58). The status is
       * part of the update's own condition, so a deactivation committing at the
       * same moment cannot be overwritten either.
       */
      const activated =
        existing.userId === user.id
          ? await tx.companyMember.updateMany({
              where: { id: existing.id, status: "INVITED" },
              data: { ...terms, status: "ACTIVE", joinedAt: new Date(), deactivatedAt: null },
            })
          : { count: 0 };
      if (activated.count === 0) {
        throw new AccessError("NOT_FOUND", "This invitation is invalid or has expired.");
      }
      membership = { id: existing.id };
    } else {
      membership = await tx.companyMember.create({
        data: {
          companyId: invite.companyId,
          userId: user.id,
          ...terms,
          status: "ACTIVE",
          joinedAt: new Date(),
        },
        select: { id: true },
      });
    }

    // A member of a company is a person of its group (E-01 §219, ADR 0002):
    // an invited account gets its person here, through HR's door, unless it
    // already has one.
    const company = await tx.company.findUniqueOrThrow({ where: { id: invite.companyId }, select: { parentGroupId: true } });
    await options.personDoor(tx, { userId: user.id, parentGroupId: company.parentGroupId, jobTitle: invite.jobTitle });

    // Joining a department is joining its team (E-13, ADR 0003), through the organization's door.
    if (terms.departmentId) {
      await options.placement(tx, { companyId: invite.companyId, userId: user.id, fromDepartmentId: null, toDepartmentId: terms.departmentId, actor: null });
    }

    // Consuming the token is what makes the link single-use (PRD #14 §239).
    const consumed = await tx.companyInvite.updateMany({
      where: { id: invite.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date(), userId: user.id, companyMemberId: membership.id },
    });
    if (consumed.count === 0) {
      throw new AccessError("CONFLICT", "This invitation has already been used.");
    }

    await recordActorActivity(
      tx,
      { companyId: invite.companyId, memberId: membership.id, userId: user.id },
      {
        module: MODULE,
        entityType: "CompanyMember",
        entityId: membership.id,
        action: "MEMBER_JOINED",
        message: `${user.firstName} ${user.lastName} joined the company`,
        metadata: { memberId: membership.id, email: invite.email } as Prisma.InputJsonValue,
      },
    );

    // Access granted is required evidence, and it commits with the membership
    // it describes (PRD #28 §95).
    await recordAuditEvent(
      {
        companyId: invite.companyId,
        actor: {
          type: "USER",
          userId: user.id,
          memberId: membership.id,
          displayNameSnapshot: `${user.firstName} ${user.lastName}`,
        },
      },
      {
        actionKey: AuditAction.TEAM_MEMBER_ACTIVATED,
        entity: { type: "CompanyMember", id: membership.id, label: invite.email },
        before: { status: "INVITED" },
        after: { status: "ACTIVE" },
        metadata: { via: "invitation" },
      },
      { tx },
    );

    return {
      userId: user.id,
      membershipId: membership.id,
      companyId: invite.companyId,
      email: invite.email,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sends the message, and reports failure rather than throwing.
 *
 * The invitation is already committed by the time this runs, so a provider
 * outage leaves something a manager can resend (PRD #14 §71, §72). The outcome
 * is recorded as a `MailDelivery` against the invitation, which is what the
 * invitation list shows (PRD #38 §14, §21).
 */
async function deliverInvite(
  context: UserContext,
  input: {
    inviteId: string;
    email: string;
    token: string;
    templateKey: "team.invitation" | "team.invitation_resend";
  },
): Promise<InviteResult> {
  const url = inviteUrl(input.token);
  const isDevelopment = process.env.NODE_ENV !== "production";
  const expiresInDays = Math.round((inviteExpiry().getTime() - Date.now()) / 86_400_000);

  let deliveryStatus: InviteResult["deliveryStatus"] = "FAILED";
  try {
    const outcome = await sendMail({
      to: input.email,
      templateKey: input.templateKey,
      variables: {
        inviterName: context.fullName,
        companyName: context.company.name,
        acceptUrl: url,
        expiresInDays: String(expiresInDays),
      },
      // One key per issued token: a retried request never mails the same link
      // twice, and a resend — a new token — always mails (PRD #38 §155).
      idempotencyKey: `invite:${input.inviteId}:${hashInviteToken(input.token).slice(0, 16)}`,
      companyId: context.companyId,
      entity: { type: "CompanyInvite", id: input.inviteId },
    });
    deliveryStatus = outcome.status;
  } catch (error) {
    // Log the failure, never the token (PRD #14 §313).
    console.error("[team] invitation email failed", {
      inviteId: input.inviteId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  return {
    inviteId: input.inviteId,
    email: input.email,
    delivered: deliveryStatus === "SENT",
    deliveryStatus,
    ...(isDevelopment ? { inviteUrl: url } : {}),
  };
}
