import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { hashPassword } from "@/lib/auth/password";
import { setMailProvider } from "@/lib/mail";
import { bootstrapCompany } from "@/lib/modules/company/company-bootstrap.service";
import * as invitations from "@/lib/modules/team/invitations/invite.service";
import { teamFormOptions } from "@/lib/modules/team/team.options";
import { inviteMemberSchema, teamListQuerySchema, updateMemberSchema } from "@/lib/modules/team/team.schema";
import * as team from "@/lib/modules/team/team.service";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { cleanupSessions, loginAsEmail, prisma } from "../../helpers";

/**
 * The CEO administers the company's own users (CEO Users & Roles §4, §20,
 * §23, §29, §46).
 *
 * Two companies this file provisions and removes: the CEO's own, and a
 * second one where one of its people also holds a membership, so isolation
 * and "deactivation ends one membership, not the identity" can be seen.
 */

const PLACE = { placement: placeMembership };
const SLUG = "ceo-admin-a";
const OTHER = "ceo-admin-b";
const EMAIL = (name: string) => `ceo-admin-${name}@nesto.test`;
const PEOPLE = ["boota", "bootb", "ceo", "ceo2", "owner", "engineer", "shared", "outsider", "newcomer"];

type Key = "OWNER" | "CEO" | "GROUP_IT" | "ENGINEER" | "VIEWER" | "PLATFORM_ADMIN";
let roles: Record<Key, string>;
let companyA: string;
let companyB: string;
const members: Record<string, string> = {};

async function removeCompany(slug: string) {
  const company = await prisma.company.findUnique({ where: { slug }, select: { id: true } });
  if (company) {
    const id = company.id;
    const invites = await prisma.companyInvite.findMany({ where: { companyId: id }, select: { id: true } });
    if (invites.length > 0) {
      await prisma.rateLimitBucket.deleteMany({ where: { OR: invites.map((invite) => ({ key: { contains: invite.id } })) } });
    }
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
    await prisma.department.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }
}

async function removeFixtures() {
  await removeCompany(SLUG);
  await removeCompany(OTHER);
  const users = await prisma.user.findMany({ where: { email: { in: PEOPLE.map(EMAIL) } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  for (const slug of [SLUG, OTHER]) {
    const group = await prisma.parentGroup.findUnique({ where: { slug }, select: { id: true } });
    if (group) {
      await prisma.personProfile.deleteMany({ where: { parentGroupId: group.id } });
      await prisma.groupDepartment.deleteMany({ where: { parentGroupId: group.id } });
      await prisma.parentGroup.delete({ where: { id: group.id } });
    }
  }
}

async function person(name: string) {
  return prisma.user.create({
    data: {
      username: `ceoadmin.${name}`,
      email: EMAIL(name),
      firstName: `Given${name}`,
      lastName: `Family${name}`,
      passwordHash: await hashPassword("a-long-enough-password"),
    },
    select: { id: true },
  });
}

async function join(companyId: string, userId: string, role: Key, key: string) {
  const member = await prisma.companyMember.create({
    data: { companyId, userId, roleId: roles[role], status: "ACTIVE", joinedAt: new Date() },
    select: { id: true },
  });
  members[key] = member.id;
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

const ceo = () => loginAsEmail(EMAIL("ceo"));
const owner = () => loginAsEmail(EMAIL("owner"));
const invite = (email: string, role: Key) => inviteMemberSchema.parse({ email, roleId: roles[role] });

beforeAll(async () => {
  setMailProvider(null);
  await removeFixtures();
  companyA = (await bootstrapCompany({ name: "CEO Admin A", slug: SLUG, ownerEmail: EMAIL("boota") })).companyId;
  companyB = (await bootstrapCompany({ name: "CEO Admin B", slug: OTHER, ownerEmail: EMAIL("bootb") })).companyId;

  const rows = await prisma.role.findMany({ where: { key: { in: ["OWNER", "CEO", "GROUP_IT", "ENGINEER", "VIEWER", "PLATFORM_ADMIN"] } } });
  roles = Object.fromEntries(rows.map((row) => [row.key, row.id])) as typeof roles;

  const ids: Record<string, string> = {};
  for (const name of ["ceo", "ceo2", "owner", "engineer", "shared", "outsider"]) ids[name] = (await person(name)).id;

  await join(companyA, ids.ceo, "CEO", "ceo");
  await join(companyA, ids.owner, "OWNER", "owner");
  await join(companyA, ids.engineer, "ENGINEER", "engineer");
  await join(companyA, ids.shared, "ENGINEER", "sharedA");
  await join(companyB, ids.shared, "VIEWER", "sharedB");
  await join(companyB, ids.outsider, "ENGINEER", "outsider");
});

afterEach(async () => {
  await prisma.companyMember.updateMany({
    where: { id: { in: [members.ceo, members.engineer, members.sharedA, members.sharedB] } },
    data: { status: "ACTIVE", deactivatedAt: null, deactivatedByMemberId: null },
  });
  await prisma.companyMember.update({ where: { id: members.ceo }, data: { roleId: roles.CEO } });
  await prisma.companyMember.update({ where: { id: members.engineer }, data: { roleId: roles.ENGINEER } });
});

afterAll(async () => {
  await cleanupSessions();
  await removeFixtures();
  await prisma.$disconnect();
});

describe("the CEO administers the company's users (§4)", () => {
  it("holds company user administration and no Owner or Group IT grant", async () => {
    const context = await ceo();
    for (const permission of ["team.member.invite", "team.member.update", "team.member.role.assign", "team.member.deactivate", "team.member.reactivate", "team.invitation.resend", "team.invitation.cancel"]) {
      expect(context.permissions, permission).toContain(permission);
    }
    expect(context.permissions).not.toContain("team.owner.assign");
    expect(context.permissions).not.toContain("team.group_role.assign");
  });

  it("is offered company roles only: no Platform Admin, Owner or Group IT", async () => {
    const options = await teamFormOptions(await ceo());
    const offered = options.roles.map((role) => role.value);
    expect(offered).toContain(roles.ENGINEER);
    expect(offered).toContain(roles.CEO);
    for (const key of ["PLATFORM_ADMIN", "OWNER", "GROUP_IT"] as const) expect(offered, key).not.toContain(roles[key]);
  });

  it("invites a new address into their own company, whatever companyId the request carries", async () => {
    const context = await ceo();
    const result = await invitations.inviteMember(context, { ...invite(EMAIL("newcomer"), "ENGINEER"), companyId: companyB } as never);
    const row = await prisma.companyInvite.findUniqueOrThrow({ where: { id: result.inviteId } });
    expect(row.companyId).toBe(companyA);
    expect(row.roleId).toBe(roles.ENGINEER);
    await invitations.resendInvitation(context, result.inviteId);
    const pending = await prisma.companyInvite.findMany({ where: { companyId: companyA, email: EMAIL("newcomer"), status: "PENDING" } });
    expect(pending).toHaveLength(1);
    await invitations.cancelInvitation(context, pending[0].id);
    const cancelled = await prisma.companyInvite.findUniqueOrThrow({ where: { id: pending[0].id } });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("reuses an existing NESTO identity instead of creating a second one", async () => {
    const context = await ceo();
    const before = await prisma.user.count({ where: { email: EMAIL("outsider") } });
    await invitations.inviteMember(context, invite(EMAIL("outsider"), "VIEWER"));
    expect(await prisma.user.count({ where: { email: EMAIL("outsider") } })).toBe(before);
    const outsider = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL("outsider") } });
    const membership = await prisma.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: companyA, userId: outsider.id } } });
    expect(membership.status).toBe("INVITED");
    // Their Company B membership is untouched.
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: members.outsider } })).status).toBe("ACTIVE");
  });

  it("answers an existing membership with a conflict, not a duplicate", async () => {
    await expectCode(invitations.inviteMember(await ceo(), invite(EMAIL("engineer"), "VIEWER")), "CONFLICT");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL("engineer") } });
    expect(await prisma.companyMember.count({ where: { companyId: companyA, userId: user.id } })).toBe(1);
  });

  it("changes a member's role, and the member's next request carries it", async () => {
    await team.updateMember(await ceo(), members.engineer, updateMemberSchema.parse({ roleId: roles.VIEWER }), PLACE);
    const engineer = await loginAsEmail(EMAIL("engineer"));
    expect(engineer.role).toBe("VIEWER");
  });
});

describe("the CEO cannot grant beyond the company (§23, §46)", () => {
  it("refuses to invite an Owner, Group IT or Platform Admin", async () => {
    const context = await ceo();
    await expectCode(invitations.inviteMember(context, invite("ceo-admin-x1@nesto.test", "OWNER")), "FORBIDDEN");
    await expectCode(invitations.inviteMember(context, invite("ceo-admin-x2@nesto.test", "GROUP_IT")), "FORBIDDEN");
    await expectCode(invitations.inviteMember(context, invite("ceo-admin-x3@nesto.test", "PLATFORM_ADMIN")), "VALIDATION_ERROR");
  });

  it("refuses to promote a member to Owner, Group IT or Platform Admin", async () => {
    const context = await ceo();
    await expectCode(team.updateMember(context, members.engineer, updateMemberSchema.parse({ roleId: roles.OWNER }), PLACE), "FORBIDDEN");
    await expectCode(team.updateMember(context, members.engineer, updateMemberSchema.parse({ roleId: roles.GROUP_IT }), PLACE), "FORBIDDEN");
    await expectCode(team.updateMember(context, members.engineer, updateMemberSchema.parse({ roleId: roles.PLATFORM_ADMIN }), PLACE), "VALIDATION_ERROR");
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: members.engineer } })).roleId).toBe(roles.ENGINEER);
  });

  it("refuses to change the Owner's access", async () => {
    await expectCode(team.deactivateMember(await ceo(), members.owner), "FORBIDDEN");
  });

  it("never lists, reads or changes another company's memberships", async () => {
    const context = await ceo();
    const list = await team.listMembers(context, teamListQuerySchema.parse({ pageSize: 100 }));
    const ids = list.data.map((row) => row.id);
    expect(ids).toContain(members.sharedA);
    expect(ids).not.toContain(members.sharedB);
    expect(ids).not.toContain(members.outsider);
    await expectCode(team.getMember(context, members.outsider), "NOT_FOUND");
    await expectCode(team.updateMember(context, members.outsider, updateMemberSchema.parse({ roleId: roles.VIEWER }), PLACE), "NOT_FOUND");
    await expectCode(team.deactivateMember(context, members.sharedB), "NOT_FOUND");
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: members.sharedB } })).status).toBe("ACTIVE");
  });
});

describe("deactivation ends one membership, not the identity (§16, §17)", () => {
  it("deactivates in Company A, leaves Company B and the account alone, and reactivates", async () => {
    const context = await ceo();
    await team.deactivateMember(context, members.sharedA);
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: members.sharedA } })).status).toBe("INACTIVE");
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: members.sharedB } })).status).toBe("ACTIVE");
    expect((await prisma.user.findUniqueOrThrow({ where: { email: EMAIL("shared") } })).status).toBe("ACTIVE");
    await team.reactivateMember(context, members.sharedA);
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: members.sharedA } })).status).toBe("ACTIVE");
  });
});

describe("the company keeps an active CEO (§20)", () => {
  it("refuses the CEO removing their own access or role", async () => {
    const context = await ceo();
    await expectCode(team.deactivateMember(context, members.ceo), "CONFLICT");
    await expectCode(team.updateMember(context, members.ceo, updateMemberSchema.parse({ roleId: roles.VIEWER }), PLACE), "CONFLICT");
  });

  it("refuses the Owner removing or demoting the last active CEO", async () => {
    const context = await owner();
    await expectCode(team.deactivateMember(context, members.ceo), "CONFLICT");
    await expectCode(team.suspendMember(context, members.ceo), "CONFLICT");
    await expectCode(team.updateMember(context, members.ceo, updateMemberSchema.parse({ roleId: roles.VIEWER }), PLACE), "CONFLICT");
    const row = await prisma.companyMember.findUniqueOrThrow({ where: { id: members.ceo } });
    expect(row.status).toBe("ACTIVE");
    expect(row.roleId).toBe(roles.CEO);
  });

  it("allows it once another active CEO exists", async () => {
    const ceo2 = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL("ceo2") }, select: { id: true } });
    const second = await join(companyA, ceo2.id, "CEO", "ceo2");
    try {
      await team.updateMember(await owner(), members.ceo, updateMemberSchema.parse({ roleId: roles.VIEWER }), PLACE);
      expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: members.ceo } })).roleId).toBe(roles.VIEWER);
    } finally {
      await prisma.companyMember.update({ where: { id: members.ceo }, data: { roleId: roles.CEO } });
      await prisma.companyMember.delete({ where: { id: second } });
    }
  });
});
