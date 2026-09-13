import { Prisma, type CompanyInviteStatus } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { sendMail } from "@/lib/mail/transport";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
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

  const [roles, departments, inviters] = await Promise.all([
    prisma.role.findMany({ select: { id: true, name: true } }),
    prisma.department.findMany({
      where: { companyId: context.companyId },
      select: { id: true, name: true },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

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
  }));
}

/* -------------------------------------------------------------------------- */
/* Invite                                                                      */
/* -------------------------------------------------------------------------- */

export async function inviteMember(
  context: UserContext,
  input: InviteMemberInput,
): Promise<InviteResult> {
  assertModule(context, MODULE);
  assertPermission(context, "team.member.invite");
  assertPermission(context, "team.member.role.assign");

  const email = normalizeEmail(input.email);
  const role = await prisma.role.findUnique({
    where: { id: input.roleId },
    select: { id: true, key: true, name: true },
  });
  if (!role) throw new AccessError("VALIDATION_ERROR", "That role does not exist.");
  // Only an Owner may create another Owner (PRD #14 §96).
  if (role.key === "OWNER") assertPermission(context, "team.owner.assign");

  const department = input.departmentId
    ? await prisma.department.findFirst({
        where: { id: input.departmentId, companyId: context.companyId, status: { not: "ARCHIVED" } },
        select: { id: true },
      })
    : null;
  if (input.departmentId && !department) {
    throw new AccessError("VALIDATION_ERROR", "That department does not exist.");
  }
  if (department) assertPermission(context, "team.member.department.assign");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  // An account that is itself disabled is an account-level problem; inviting it
  // into a company must not quietly re-enable it (PRD #14 §320).
  if (user && user.status !== "ACTIVE") {
    throw new AccessError(
      "CONFLICT",
      "That account is not active. It has to be resolved before an invitation can be accepted.",
    );
  }

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

  return deliverInvite(created.id, email, token, context.company.name, context.fullName);
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
      select: { id: true, email: true, status: true },
    }),
  );

  if (invite.status === "ACCEPTED") {
    throw new AccessError("CONFLICT", "That invitation has already been accepted.");
  }
  if (invite.status === "CANCELLED") {
    throw new AccessError("CONFLICT", "That invitation was cancelled.");
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

  return deliverInvite(inviteId, invite.email, token, context.company.name, context.fullName);
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
 */
export async function acceptInvite(
  input: AcceptInviteRequest,
  options: { authenticatedUserId?: string } = {},
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
      user = await tx.user.create({
        data: {
          email: invite.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash: await hashPassword(input.password),
          status: "ACTIVE",
        },
        select: { id: true, status: true, firstName: true, lastName: true },
      });
    }

    const membership = invite.companyMemberId
      ? await tx.companyMember.update({
          where: { id: invite.companyMemberId },
          data: { status: "ACTIVE", joinedAt: new Date(), deactivatedAt: null },
          select: { id: true },
        })
      : await tx.companyMember.upsert({
          where: { companyId_userId: { companyId: invite.companyId, userId: user.id } },
          update: { status: "ACTIVE", joinedAt: new Date(), deactivatedAt: null },
          create: {
            companyId: invite.companyId,
            userId: user.id,
            roleId: invite.roleId,
            departmentId: invite.departmentId,
            jobTitle: invite.jobTitle,
            status: "ACTIVE",
            joinedAt: new Date(),
          },
          select: { id: true },
        });

    // Consuming the token is what makes the link single-use (PRD #14 §239).
    const consumed = await tx.companyInvite.updateMany({
      where: { id: invite.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date(), userId: user.id, companyMemberId: membership.id },
    });
    if (consumed.count === 0) {
      throw new AccessError("CONFLICT", "This invitation has already been used.");
    }

    await tx.activity.create({
      data: {
        companyId: invite.companyId,
        module: MODULE,
        entityType: "CompanyMember",
        entityId: membership.id,
        action: "MEMBER_JOINED",
        message: `${user.firstName} ${user.lastName} joined the company`,
        actorMemberId: membership.id,
        actorUserId: user.id,
        metadata: { memberId: membership.id, email: invite.email } as Prisma.InputJsonValue,
      },
    });

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
 * outage leaves something a manager can resend (PRD #14 §71, §72).
 */
async function deliverInvite(
  inviteId: string,
  email: string,
  token: string,
  companyName: string,
  inviterName: string,
): Promise<InviteResult> {
  const url = inviteUrl(token);
  const isDevelopment = process.env.NODE_ENV !== "production";

  try {
    await sendMail({
      to: email,
      subject: `${inviterName} invited you to ${companyName} on NESTO`,
      body: [
        `${inviterName} has invited you to join ${companyName} on NESTO.`,
        "",
        `Accept the invitation: ${url}`,
        "",
        "If you were not expecting this, you can ignore this message.",
      ].join("\n"),
    });

    return {
      inviteId,
      email,
      delivered: true,
      ...(isDevelopment ? { inviteUrl: url } : {}),
    };
  } catch (error) {
    // Log the failure, never the token (PRD #14 §313).
    console.error("[team] invitation email failed", { inviteId, error });
    return {
      inviteId,
      email,
      delivered: false,
      ...(isDevelopment ? { inviteUrl: url } : {}),
    };
  }
}
