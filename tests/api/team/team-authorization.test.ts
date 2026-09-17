import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { hashPassword } from "@/lib/auth/password";
import type { UserContext } from "@/lib/context/types";
import { setMailProvider } from "@/lib/mail";
import { bootstrapCompany } from "@/lib/modules/company/company-bootstrap.service";
import * as invitations from "@/lib/modules/team/invitations/invite.service";
import { teamListQuerySchema, updateMemberSchema } from "@/lib/modules/team/team.schema";
import * as team from "@/lib/modules/team/team.service";
import { cleanupSessions, loginAsEmail, prisma } from "../../helpers";

/**
 * Owner protection and the invitation lifecycle (PRD #47 §57-§59).
 *
 * Everything here runs in a company this file provisions and removes. The
 * rules under test are about Owners and about access being granted, so the
 * fixtures have to demote Owners, deactivate members and accept invitations —
 * none of which may happen to the shared seed company while other suites are
 * reading it.
 */

const SLUG = "prd47-team-authz";
const EMAIL = (name: string) => `prd47-team-${name}@nesto.test`;
const PEOPLE = ["boot", "owner1", "owner2", "owner3", "groupit", "outsider", "dormant", "relisted", "promoted", "ownerinv", "superseded"];

let companyId: string;
let roles: Record<"OWNER" | "GROUP_IT" | "VIEWER" | "ENGINEER", string>;
const members: Record<string, string> = {};

async function removeFixtures() {
  const company = await prisma.company.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const users = await prisma.user.findMany({
    where: { email: { in: PEOPLE.map(EMAIL) } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  if (company) {
    const id = company.id;
    const invites = await prisma.companyInvite.findMany({ where: { companyId: id }, select: { id: true } });
    await prisma.rateLimitBucket.deleteMany({
      where: { OR: invites.map((invite) => ({ key: { contains: invite.id } })) },
    });
    await prisma.mailDelivery.deleteMany({ where: { companyId: id } });
    await prisma.auditEvent.deleteMany({ where: { companyId: id } });
    await prisma.activity.deleteMany({ where: { companyId: id } });
    await prisma.session.deleteMany({ where: { currentCompanyId: id } });
    await prisma.companyInvite.deleteMany({ where: { companyId: id } });
    await prisma.companyMember.deleteMany({ where: { companyId: id } });
    await prisma.companyNumberingScheme.deleteMany({ where: { companyId: id } });
    await prisma.companyStorageQuota.deleteMany({ where: { companyId: id } });
    await prisma.financeSettings.deleteMany({ where: { companyId: id } });
    await prisma.companyIntegrationSettings.deleteMany({ where: { companyId: id } });
    await prisma.companySettings.deleteMany({ where: { companyId: id } });
    await prisma.companyModule.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }
  // Provisioning gave the company a parent group of its own (E-06 §8).
  const group = await prisma.parentGroup.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (group) {
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: group.id } });
    await prisma.parentGroup.delete({ where: { id: group.id } });
  }
  if (userIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function person(
  name: string,
  profile: { status?: "ACTIVE" | "INACTIVE"; phone?: string; avatarUrl?: string; lastLoginAt?: Date } = {},
) {
  return prisma.user.create({
    data: {
      username: `probe.${name.toLowerCase()}`,
      email: EMAIL(name),
      firstName: `Given${name}`,
      lastName: `Family${name}`,
      passwordHash: await hashPassword("a-long-enough-password"),
      status: profile.status ?? "ACTIVE",
      phone: profile.phone,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: profile.lastLoginAt,
    },
    select: { id: true },
  });
}

async function join(name: string, role: keyof typeof roles, status: "ACTIVE" | "INACTIVE" | "SUSPENDED" = "ACTIVE") {
  const user = await person(name);
  const member = await prisma.companyMember.create({
    data: { companyId, userId: user.id, roleId: roles[role], status, joinedAt: new Date() },
    select: { id: true },
  });
  members[name] = member.id;
  return member.id;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
}

function tokenOf(result: invitations.InviteResult): string {
  return result.inviteUrl!.split("/invite/")[1];
}

beforeAll(async () => {
  setMailProvider(null);
  await removeFixtures();
  const provisioned = await bootstrapCompany({ name: "PRD 47 Team Authorization", slug: SLUG, ownerEmail: EMAIL("boot") });
  companyId = provisioned.companyId;

  const rows = await prisma.role.findMany({ where: { key: { in: ["OWNER", "GROUP_IT", "VIEWER", "ENGINEER"] } } });
  roles = Object.fromEntries(rows.map((row) => [row.key, row.id])) as typeof roles;

  await join("owner1", "OWNER");
  await join("owner2", "OWNER");
  await join("owner3", "OWNER", "INACTIVE");
  await join("groupit", "GROUP_IT");
});

afterEach(async () => {
  // Owner fixtures return to two active Owners and one removed one.
  await prisma.companyMember.updateMany({
    where: { id: { in: [members.owner1, members.owner2] } },
    data: { roleId: roles.OWNER, status: "ACTIVE" },
  });
});

afterAll(async () => {
  await cleanupSessions();
  await removeFixtures();
  await prisma.$disconnect();
});

const groupIt = () => loginAsEmail(EMAIL("groupit"));
const owner1 = () => loginAsEmail(EMAIL("owner1"));

/* -------------------------------------------------------------------------- */
/* Owners (C-P1-2)                                                             */
/* -------------------------------------------------------------------------- */

describe("an Owner's role and access are the Owner grant's to change (PRD #47 §57)", () => {
  it("refuses Group IT demoting an Owner even while another active Owner remains", async () => {
    const context = await groupIt();
    await expectCode(
      team.updateMember(context, members.owner1, updateMemberSchema.parse({ roleId: roles.VIEWER })),
      "FORBIDDEN",
    );
    const row = await prisma.companyMember.findUniqueOrThrow({ where: { id: members.owner1 } });
    expect(row.roleId).toBe(roles.OWNER);
  });

  it("refuses Group IT suspending, deactivating or restoring an Owner", async () => {
    const context = await groupIt();
    await expectCode(team.suspendMember(context, members.owner1), "FORBIDDEN");
    await expectCode(team.deactivateMember(context, members.owner2), "FORBIDDEN");
    await expectCode(team.reactivateMember(context, members.owner3), "FORBIDDEN");

    const rows = await prisma.companyMember.findMany({
      where: { id: { in: [members.owner1, members.owner2, members.owner3] } },
      select: { status: true },
    });
    expect(rows.map((row) => row.status).sort()).toEqual(["ACTIVE", "ACTIVE", "INACTIVE"]);
  });

  it("does not offer those actions on an Owner to Group IT", async () => {
    const detail = await team.getMember(await groupIt(), members.owner1);
    expect(detail.capabilities).toMatchObject({ canAssignRole: false, canDeactivate: false, canSuspend: false });
  });

  it("lets an Owner demote another Owner", async () => {
    const context = await owner1();
    const updated = await team.updateMember(context, members.owner2, updateMemberSchema.parse({ roleId: roles.VIEWER }));
    expect(updated.membership.role.key).toBe("VIEWER");
  });

  it("never lets two simultaneous demotions leave the company without an active Owner", async () => {
    const [first, second] = await Promise.all([owner1(), loginAsEmail(EMAIL("owner2"))]);
    const outcomes = await Promise.allSettled([
      team.updateMember(first, members.owner2, updateMemberSchema.parse({ roleId: roles.VIEWER })),
      team.updateMember(second, members.owner1, updateMemberSchema.parse({ roleId: roles.VIEWER })),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(AccessError);
    expect((refused.reason as AccessError).code).toBe("CONFLICT");

    const owners = await prisma.companyMember.count({ where: { companyId, status: "ACTIVE", role: { key: "OWNER" } } });
    expect(owners).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Invitations (C-P1-3, C-P1-4, C-P1-5)                                        */
/* -------------------------------------------------------------------------- */

async function invite(context: UserContext, name: string, role: keyof typeof roles) {
  return invitations.inviteMember(context, {
    email: EMAIL(name),
    roleId: roles[role],
    firstName: undefined,
    lastName: undefined,
    departmentId: undefined,
    jobTitle: undefined,
  });
}

async function membershipOf(name: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL(name) }, select: { id: true } });
  return prisma.companyMember.findUniqueOrThrow({
    where: { companyId_userId: { companyId, userId: user.id } },
    select: { id: true, status: true, roleId: true },
  });
}

describe("only the invited person activates an invitation (PRD #47 §58)", () => {
  it("refuses to reactivate an INVITED membership", async () => {
    const context = await groupIt();
    const user = await person("outsider");
    await invite(context, "outsider", "VIEWER");
    const membership = await membershipOf("outsider");

    await expectCode(team.reactivateMember(context, membership.id), "CONFLICT");
    expect((await membershipOf("outsider")).status).toBe("INVITED");
    void user;
  });

  it("does not let an accepted link undo a deactivation, and withdraws the invitation", async () => {
    const context = await groupIt();
    const user = await person("dormant");
    const sent = await invite(context, "dormant", "VIEWER");
    const membership = await membershipOf("dormant");

    await team.deactivateMember(context, membership.id);
    const row = await prisma.companyInvite.findUniqueOrThrow({ where: { id: sent.inviteId } });
    expect(row.status).toBe("CANCELLED");

    // Even a link that somehow stayed live does not reactivate the membership.
    await prisma.companyInvite.update({ where: { id: sent.inviteId }, data: { status: "PENDING", cancelledAt: null } });
    await expectCode(
      invitations.acceptInvite({ token: tokenOf(sent) }, { authenticatedUserId: user.id }),
      "NOT_FOUND",
    );
    expect((await membershipOf("dormant")).status).toBe("INACTIVE");
  });

  it("applies the role of the invitation being accepted, including a re-invitation after expiry", async () => {
    const context = await groupIt();
    const user = await person("relisted");
    const first = await invite(context, "relisted", "VIEWER");
    await prisma.companyInvite.update({ where: { id: first.inviteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const second = await invite(context, "relisted", "ENGINEER");
    // The pending membership already describes the new terms.
    expect((await membershipOf("relisted")).roleId).toBe(roles.ENGINEER);

    const accepted = await invitations.acceptInvite({ token: tokenOf(second) }, { authenticatedUserId: user.id });
    const joined = await prisma.companyMember.findUniqueOrThrow({ where: { id: accepted.membershipId } });
    expect(joined).toMatchObject({ status: "ACTIVE", roleId: roles.ENGINEER });
  });

  it("uses the invitation's role at acceptance even when the membership says otherwise", async () => {
    const context = await groupIt();
    const user = await person("promoted");
    const sent = await invite(context, "promoted", "ENGINEER");
    const membership = await membershipOf("promoted");
    await prisma.companyMember.update({ where: { id: membership.id }, data: { roleId: roles.VIEWER } });

    await invitations.acceptInvite({ token: tokenOf(sent) }, { authenticatedUserId: user.id });
    expect((await membershipOf("promoted")).roleId).toBe(roles.ENGINEER);
  });

  it("re-runs the role checks on resend: Group IT cannot revive an Owner invitation", async () => {
    const sent = await invite(await owner1(), "ownerinv", "OWNER");
    await prisma.companyInvite.update({ where: { id: sent.inviteId }, data: { status: "EXPIRED" } });

    await expectCode(invitations.resendInvitation(await groupIt(), sent.inviteId), "FORBIDDEN");
    const row = await prisma.companyInvite.findUniqueOrThrow({ where: { id: sent.inviteId } });
    expect(row.status).toBe("EXPIRED");
  });

  it("refuses to revive an invitation a newer one replaced", async () => {
    const context = await groupIt();
    const first = await invite(context, "superseded", "VIEWER");
    await prisma.companyInvite.update({ where: { id: first.inviteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const second = await invite(context, "superseded", "VIEWER");

    await expectCode(invitations.resendInvitation(context, first.inviteId), "CONFLICT");
    const [old, current] = await Promise.all([
      prisma.companyInvite.findUniqueOrThrow({ where: { id: first.inviteId } }),
      prisma.companyInvite.findUniqueOrThrow({ where: { id: second.inviteId } }),
    ]);
    expect(old.status).toBe("EXPIRED");
    expect(current.status).toBe("PENDING");
  });
});

describe("an invitee is an address until they accept (PRD #47 §59)", () => {
  it("shows an INVITED membership by its email only — no name, photo, phone or last sign-in", async () => {
    const context = await groupIt();
    const email = EMAIL("boot");
    // The bootstrap Owner has no account yet; give the address one with a
    // full profile, then invite it as somebody else would.
    await prisma.companyInvite.updateMany({ where: { companyId, email }, data: { status: "CANCELLED" } });
    await prisma.user.create({
      data: {
        username: `bootstrap.${email.split("@")[0].toLowerCase()}`,
        email,
        firstName: "Privatefirst",
        lastName: "Privatelast",
        passwordHash: await hashPassword("a-long-enough-password"),
        phone: "+355 69 000 0000",
        avatarUrl: "https://example.test/avatar.png",
        lastLoginAt: new Date(),
      },
    });
    await invite(context, "boot", "VIEWER");
    const membership = await membershipOf("boot");

    const listed = await team.listMembers(context, teamListQuerySchema.parse({ status: ["INVITED"], limit: 100 }));
    const row = listed.data.find((member) => member.id === membership.id)!;
    expect(row.name.fullName).toBe(email);
    expect(row).toMatchObject({ avatarUrl: null, lastLoginAt: null });
    expect(JSON.stringify(row)).not.toContain("Private");

    const detail = await team.getMember(context, membership.id);
    expect(detail.profile).toMatchObject({ fullName: email, phone: null, avatarUrl: null });
    expect(detail.securityMetadata?.lastLoginAt ?? null).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("Private");

    // Nor is the hidden name searchable.
    const searched = await team.listMembers(context, teamListQuerySchema.parse({ search: "Privatefirst" }));
    expect(searched.data.map((member) => member.id)).not.toContain(membership.id);
  });

  it("answers an inactive account's address exactly as any other", async () => {
    const context = await groupIt();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL("outsider") } });
    await prisma.user.update({ where: { id: user.id }, data: { status: "INACTIVE" } });

    // No "that account is not active" — the account's state is not the company's to learn.
    const pending = await prisma.companyInvite.findFirstOrThrow({ where: { companyId, email: EMAIL("outsider"), status: "PENDING" } });
    await prisma.companyInvite.update({ where: { id: pending.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const result = await invite(context, "outsider", "VIEWER");
    const unknown = await invitations.inviteMember(context, {
      email: "prd47-team-nobody@nesto.test",
      roleId: roles.VIEWER,
      firstName: undefined,
      lastName: undefined,
      departmentId: undefined,
      jobTitle: undefined,
    });
    expect(Object.keys(result).sort()).toEqual(Object.keys(unknown).sort());
    expect(result.deliveryStatus).toBe(unknown.deliveryStatus);

    // Acceptance still refuses the disabled account.
    await expectCode(invitations.acceptInvite({ token: tokenOf(result) }, { authenticatedUserId: user.id }), "CONFLICT");
  });
});
