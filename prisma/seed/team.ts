/**
 * Team fixtures: membership lifecycle and invitations (PRD #14 §300–§306).
 *
 * Every state the Team module has to render is present in the seed, because a
 * screen that has never been seen with data in it has never really been built:
 * an active member, an invited one, a deactivated one, a suspended one, and
 * invitations that are pending, expired, cancelled and accepted (PRD #14 §304).
 *
 * They are test fixtures, so they live in Fixture Works rather than in a demo
 * company (E-06 §45). A department's manager is no longer set here: it is the
 * company manager position the organization seed creates (E-06 §13, §37).
 */
import type { PrismaClient } from "@prisma/client";

import { hashInviteToken } from "../../lib/modules/team/invitations/invite.token";
import { hashPassword } from "../../lib/auth/password";
import {
  DEMO_EXISTING_ACCOUNT_INVITE_TOKEN,
  DEMO_INVITE_TOKEN,
  DEMO_PASSWORD,
  INVITED_USER,
  FIXTURE_OWNER,
  FIXTURE_WORKS,
  INVITE_IDS,
  daysFromNow,
} from "./constants";
import type { SeedMembers } from "./constants";

export async function seedTeamRecords(prisma: PrismaClient, members: SeedMembers) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const roleRows = await prisma.role.findMany({ select: { id: true, key: true } });
  const roleId = new Map(roleRows.map((row) => [row.key, row.id]));

  const departments = await prisma.department.findMany({
    where: { companyId: FIXTURE_WORKS },
    select: { id: true, key: true },
  });
  const departmentId = new Map(departments.map((row) => [row.key, row.id]));

  const owner = members.get(FIXTURE_OWNER.id);
  if (!owner) throw new Error("Seed order: team fixtures need the Fixture Works owner.");

  /* ---- Membership lifecycle ------------------------------------------- */

  // Active members joined; nobody's invitedAt is invented, because most of them
  // were never invited — they are the founding seed (PRD #14 §12).
  await prisma.companyMember.updateMany({
    where: { companyId: FIXTURE_WORKS, status: "ACTIVE" },
    data: { joinedAt: daysFromNow(-180) },
  });

  // The two negative-path memberships carry the dates their state implies, so
  // the Inactive section is not a list of blank cells (PRD #14 §36).
  await prisma.companyMember.updateMany({
    where: { companyId: FIXTURE_WORKS, userId: "user_membership_inactive" },
    data: {
      joinedAt: daysFromNow(-150),
      deactivatedAt: daysFromNow(-20),
      deactivatedByMemberId: owner,
    },
  });

  await prisma.companyMember.updateMany({
    where: { companyId: FIXTURE_WORKS, userId: "user_membership_suspended" },
    data: {
      joinedAt: daysFromNow(-120),
      deactivatedAt: daysFromNow(-5),
      deactivatedByMemberId: owner,
    },
  });

  /* ---- Invitations ----------------------------------------------------- */

  const viewerRole = roleId.get("VIEWER")!;
  const engineerRole = roleId.get("ENGINEER")!;

  /**
   * A pending invitation for somebody with no account: the whole acceptance
   * flow — set a name, choose a password, land in the workspace — starts here
   * (PRD #14 §74, §305).
   */
  await upsertInvite(prisma, {
    id: INVITE_IDS.pending,
    email: "new-engineer@nesto.test",
    roleId: engineerRole,
    departmentId: departmentId.get("engineering") ?? null,
    jobTitle: "Site Engineer",
    tokenHash: hashInviteToken(DEMO_INVITE_TOKEN),
    status: "PENDING",
    expiresAt: daysFromNow(5),
    createdByMemberId: owner,
    createdAt: daysFromNow(-2),
  });

  /** Expired but never swept, which is exactly how it reaches a real list. */
  await upsertInvite(prisma, {
    id: INVITE_IDS.expired,
    email: "lapsed-invite@nesto.test",
    roleId: viewerRole,
    departmentId: null,
    jobTitle: null,
    // A distinct hash per row: tokenHash is unique, and the expired token is
    // never meant to be used.
    tokenHash: hashInviteToken("nesto-demo-expired-invite-token"),
    status: "PENDING",
    expiresAt: daysFromNow(-3),
    createdByMemberId: owner,
    createdAt: daysFromNow(-10),
  });

  await upsertInvite(prisma, {
    id: INVITE_IDS.cancelled,
    email: "withdrawn-invite@nesto.test",
    roleId: viewerRole,
    departmentId: departmentId.get("executive") ?? null,
    jobTitle: "Office Assistant",
    tokenHash: hashInviteToken("nesto-demo-cancelled-invite-token"),
    status: "CANCELLED",
    expiresAt: daysFromNow(2),
    cancelledAt: daysFromNow(-1),
    createdByMemberId: owner,
    createdAt: daysFromNow(-6),
  });

  /**
   * An accepted invitation pointing at a member who is really here, so the
   * list shows the ordinary end state rather than only the interesting ones.
   */
  await upsertInvite(prisma, {
    id: INVITE_IDS.accepted,
    email: FIXTURE_OWNER.email,
    roleId: roleId.get("OWNER")!,
    departmentId: departmentId.get("executive") ?? null,
    jobTitle: FIXTURE_OWNER.jobTitle,
    tokenHash: hashInviteToken("nesto-demo-accepted-invite-token"),
    status: "ACCEPTED",
    expiresAt: daysFromNow(-160),
    acceptedAt: daysFromNow(-165),
    userId: FIXTURE_OWNER.id,
    companyMemberId: owner,
    createdByMemberId: owner,
    createdAt: daysFromNow(-170),
  });

  /**
   * Somebody who already has a NESTO account and has been invited to this one:
   * an INVITED membership plus the invitation that created it (PRD #14 §64).
   *
   * This is the state the People list shows as "Invited", and the branch of the
   * public invitation page that asks the person to sign in rather than choose a
   * password (PRD #14 §75).
   */
  await prisma.user.upsert({
    where: { id: INVITED_USER.id },
    update: {},
    create: {
      id: INVITED_USER.id,
      username: INVITED_USER.username,
      email: INVITED_USER.email,
      firstName: INVITED_USER.firstName,
      lastName: INVITED_USER.lastName,
      passwordHash,
      status: "ACTIVE",
    },
  });

  const invitedMembership = await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: FIXTURE_WORKS, userId: INVITED_USER.id } },
    update: {
      status: "INVITED",
      invitedAt: daysFromNow(-1),
      invitedByMemberId: owner,
      joinedAt: null,
    },
    create: {
      id: "member_invited",
      companyId: FIXTURE_WORKS,
      userId: INVITED_USER.id,
      roleId: viewerRole,
      departmentId: departmentId.get("projects") ?? null,
      jobTitle: "Consultant",
      status: "INVITED",
      invitedAt: daysFromNow(-1),
      invitedByMemberId: owner,
    },
    select: { id: true },
  });

  await upsertInvite(prisma, {
    id: INVITE_IDS.existingAccount,
    email: INVITED_USER.email,
    roleId: viewerRole,
    departmentId: departmentId.get("projects") ?? null,
    jobTitle: "Consultant",
    tokenHash: hashInviteToken(DEMO_EXISTING_ACCOUNT_INVITE_TOKEN),
    status: "PENDING",
    expiresAt: daysFromNow(6),
    userId: INVITED_USER.id,
    companyMemberId: invitedMembership.id,
    createdByMemberId: owner,
    createdAt: daysFromNow(-1),
  });

  return 5;
}

type InviteFixture = {
  id: string;
  email: string;
  roleId: string;
  departmentId: string | null;
  jobTitle: string | null;
  tokenHash: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  expiresAt: Date;
  acceptedAt?: Date;
  cancelledAt?: Date;
  userId?: string;
  companyMemberId?: string | null;
  createdByMemberId: string;
  createdAt: Date;
};

/** Idempotent, so re-running the seed on an existing database converges. */
async function upsertInvite(prisma: PrismaClient, fixture: InviteFixture) {
  const data = {
    companyId: FIXTURE_WORKS,
    email: fixture.email,
    roleId: fixture.roleId,
    departmentId: fixture.departmentId,
    jobTitle: fixture.jobTitle,
    tokenHash: fixture.tokenHash,
    status: fixture.status,
    expiresAt: fixture.expiresAt,
    acceptedAt: fixture.acceptedAt ?? null,
    cancelledAt: fixture.cancelledAt ?? null,
    userId: fixture.userId ?? null,
    companyMemberId: fixture.companyMemberId ?? null,
    createdByMemberId: fixture.createdByMemberId,
    createdAt: fixture.createdAt,
  };

  await prisma.companyInvite.upsert({
    where: { id: fixture.id },
    update: data,
    create: { id: fixture.id, ...data },
  });
}
