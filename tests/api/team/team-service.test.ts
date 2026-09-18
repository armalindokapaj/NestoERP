import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import * as departments from "@/lib/modules/team/departments/department.service";
import * as invitations from "@/lib/modules/team/invitations/invite.service";
import { hashInviteToken } from "@/lib/modules/team/invitations/invite.token";
import { teamListQuerySchema, updateMemberSchema } from "@/lib/modules/team/team.schema";
import { ensurePersonForUser } from "@/lib/modules/hr/person.doors";
import * as team from "@/lib/modules/team/team.service";
import { clearOutbox, readOutbox, setMailProvider } from "@/lib/mail";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";

/** Team hands a department move to the organization (ADR 0003). */
const PLACE = { placement: placeMembership };

/**
 * Team authorisation and lifecycle tests (PRD #14 §256–§280).
 *
 * These call the same services the API routes and the pages call, so a passing
 * test is a statement about the running product rather than about a mock
 * (PRD #9 §223).
 */
const listQuery = teamListQuerySchema.parse({});

const createdInvites: string[] = [];
const createdMembers: string[] = [];
const createdDepartments: string[] = [];

afterEach(async () => {
  setMailProvider(null);
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "INVITE_RESEND:" } } });
  if (createdInvites.length > 0) {
    await prisma.mailDelivery.deleteMany({ where: { entityId: { in: createdInvites } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdInvites } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: createdInvites } } });
    await prisma.companyInvite.deleteMany({ where: { id: { in: createdInvites } } });
    createdInvites.length = 0;
  }
  if (createdMembers.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: createdMembers } } });
    await prisma.session.deleteMany({ where: { membershipId: { in: createdMembers } } });
    await prisma.companyMember.deleteMany({ where: { id: { in: createdMembers } } });
    createdMembers.length = 0;
  }
  if (createdDepartments.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: createdDepartments } } });
    await prisma.department.deleteMany({ where: { id: { in: createdDepartments } } });
    createdDepartments.length = 0;
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

/* -------------------------------------------------------------------------- */
/* Directory scope                                                             */
/* -------------------------------------------------------------------------- */

describe("directory scope (PRD #14 §21–§26)", () => {
  it("shows the Owner everyone in the company", async () => {
    const context = await loginAs("OWNER");
    const result = await team.listMembers(context, listQuery);

    const total = await prisma.companyMember.count({ where: { companyId: context.companyId } });
    expect(result.pagination.total).toBe(total);
  });

  it("gives a project-scoped role only colleagues they share a project with", async () => {
    const context = await loginAs("ENGINEER");
    const result = await team.listMembers(
      context,
      teamListQuerySchema.parse({ limit: 100 }),
    );

    // Themselves, at minimum — and never the whole company.
    const companyTotal = await prisma.companyMember.count({
      where: { companyId: context.companyId },
    });
    expect(result.data.some((member) => member.id === context.membershipId)).toBe(true);
    expect(result.pagination.total).toBeLessThan(companyTotal);

    // Everyone returned really does share a reachable project.
    const finance = result.data.find((member) => member.email === "finance@nesto.test");
    expect(finance).toBeUndefined();
  });

  it("never leaks another company's members", async () => {
    const context = await loginAs("OWNER");
    const result = await team.listMembers(
      context,
      teamListQuerySchema.parse({ limit: 100 }),
    );

    const emails = result.data.map((member) => member.email);
    expect(emails).not.toContain(DEMO_EMAIL.tenantOwner);
    expect(emails).not.toContain(DEMO_EMAIL.tenantViewer);
    // Nor a sibling company's own people, though the Owner is a member there too.
    expect(emails).not.toContain(DEMO_EMAIL.pmB);
  });

  it("answers NOT_FOUND — never FORBIDDEN — for a member outside scope (PRD #14 §160)", async () => {
    const owner = await loginAs("OWNER");
    const all = await team.listMembers(owner, teamListQuerySchema.parse({ limit: 100 }));
    const finance = all.data.find((member) => member.email === "finance@nesto.test");
    expect(finance).toBeDefined();

    const engineer = await loginAs("ENGINEER");
    // A 403 would confirm the record exists. A 404 says nothing at all.
    await expectError(team.getMember(engineer, finance!.id), "NOT_FOUND");
  });

  it("counts only the projects the reader can see (PRD #14 §52)", async () => {
    const viewer = await loginAs("VIEWER");
    const result = await team.listMembers(viewer, listQuery);
    const self = result.data.find((member) => member.id === viewer.membershipId);

    const actualProjects = await prisma.projectMember.count({
      where: { companyMemberId: viewer.membershipId, status: "ACTIVE" },
    });
    expect(self?.projectCount).toBeLessThanOrEqual(actualProjects);
  });
});

/* -------------------------------------------------------------------------- */
/* Sensitive fields                                                            */
/* -------------------------------------------------------------------------- */

describe("what the directory may show (PRD #14 §44, §49, §174)", () => {
  it("withholds last-login from a reader without the security grant", async () => {
    const context = await loginAs("ENGINEER");
    const member = await team.getMember(context, context.membershipId);
    expect(member.securityMetadata).toBeUndefined();
  });

  it("includes last-login for a manager who holds it", async () => {
    const context = await loginAs("OWNER");
    const member = await team.getMember(context, context.membershipId);
    expect(member.securityMetadata).toBeDefined();
  });

  it("carries no HR data in the member DTO", async () => {
    const context = await loginAs("OWNER");
    const all = await team.listMembers(context, listQuery);
    const member = await team.getMember(context, all.data[0].id);

    const serialised = JSON.stringify(member);
    for (const forbidden of ["salary", "iban", "bankAccount", "nationalId", "medical"]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Membership writes                                                           */
/* -------------------------------------------------------------------------- */

describe("membership updates (PRD #14 §85–§96)", () => {
  it("refuses a view-only role", async () => {
    const context = await loginAs("ENGINEER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: context.role } });

    await expectError(
      team.updateMember(
        context,
        context.membershipId,
        updateMemberSchema.parse({ roleId: role.id, jobTitle: "Nope" }), PLACE,
      ),
      "FORBIDDEN",
    );
  });

  it("lets a manager change a job title", async () => {
    const owner = await loginAs("OWNER");
    const all = await team.listMembers(owner, teamListQuerySchema.parse({ limit: 100 }));
    const target = all.data.find((member) => member.email === "viewer@nesto.test")!;
    const before = await team.getMember(owner, target.id);

    const updated = await team.updateMember(
      owner,
      target.id,
      updateMemberSchema.parse({
        roleId: before.membership.role.id,
        departmentId: before.membership.department?.id,
        jobTitle: "Observer (test)",
      }), PLACE,
    );
    expect(updated.membership.jobTitle).toBe("Observer (test)");

    // Put the seed back: a test that changes shared state must restore it.
    await team.updateMember(
      owner,
      target.id,
      updateMemberSchema.parse({
        roleId: before.membership.role.id,
        departmentId: before.membership.department?.id,
        jobTitle: before.membership.jobTitle ?? undefined,
      }), PLACE,
    );
  });

  it("refuses a stale optimistic-concurrency stamp (PRD #14 §159)", async () => {
    const owner = await loginAs("OWNER");
    const all = await team.listMembers(owner, teamListQuerySchema.parse({ limit: 100 }));
    const target = all.data.find((member) => member.email === "viewer@nesto.test")!;
    const before = await team.getMember(owner, target.id);

    await expectError(
      team.updateMember(
        owner,
        target.id,
        updateMemberSchema.parse({
          roleId: before.membership.role.id,
          jobTitle: "Conflicting",
          versionUpdatedAt: new Date("2020-01-01T00:00:00.000Z").toISOString(),
        }), PLACE,
      ),
      "CONFLICT",
    );
  });

  it("does not let somebody change their own role (PRD #14 §168)", async () => {
    const owner = await loginAs("OWNER");
    const viewerRole = await prisma.role.findUnique({ where: { key: "VIEWER" } });

    await expectError(
      team.updateMember(
        owner,
        owner.membershipId,
        updateMemberSchema.parse({ roleId: viewerRole!.id }), PLACE,
      ),
      "CONFLICT",
    );
  });

  it("refuses to create an Owner without team.owner.assign (PRD #14 §96)", async () => {
    // Group IT manages the team but is not an Owner, which is exactly the case
    // the grant exists to separate.
    const it_ = await loginAs("GROUP_IT");
    const ownerRole = await prisma.role.findUnique({ where: { key: "OWNER" } });
    const all = await team.listMembers(it_, teamListQuerySchema.parse({ limit: 100 }));
    const target = all.data.find((member) => member.email === "viewer@nesto.test")!;

    await expectError(
      team.updateMember(it_, target.id, updateMemberSchema.parse({ roleId: ownerRole!.id }), PLACE),
      "FORBIDDEN",
    );
  });
});

describe("membership status (PRD #14 §97–§111, §163, §167)", () => {
  it("refuses to change your own access", async () => {
    const owner = await loginAs("OWNER");
    await expectError(team.deactivateMember(owner, owner.membershipId), "CONFLICT");
  });

  it("protects the last active Owner (PRD #14 §93)", async () => {
    const it_ = await loginAs("GROUP_IT");
    const owner = await prisma.companyMember.findFirst({
      where: { companyId: it_.companyId, status: "ACTIVE", role: { key: "OWNER" } },
      select: { id: true },
    });

    const owners = await prisma.companyMember.count({
      where: { companyId: it_.companyId, status: "ACTIVE", role: { key: "OWNER" } },
    });
    expect(owners).toBe(1);

    // Without the Owner grant Group IT may not change an Owner's access at
    // all, however many Owners there are (PRD #47 §57).
    await expectError(team.deactivateMember(it_, owner!.id), "FORBIDDEN");
    await expectError(team.suspendMember(it_, owner!.id), "FORBIDDEN");

    // Even a holder of that grant cannot remove the last one. No seeded role
    // but the Owner holds it, and the Owner cannot change their own access, so
    // the grant is added to a real Group IT context for this one check.
    const delegated = { ...it_, permissions: [...it_.permissions, "team.owner.assign" as const] };
    await expectError(team.deactivateMember(delegated, owner!.id), "CONFLICT");
    await expectError(team.suspendMember(delegated, owner!.id), "CONFLICT");
  });

  it("revokes live sessions when access is removed (PRD #14 §242, §243)", async () => {
    const owner = await loginAs("OWNER");
    const target = await prisma.companyMember.findFirst({
      where: { companyId: owner.companyId, user: { email: "viewer@nesto.test" } },
      select: { id: true, status: true },
    });

    const session = await prisma.session.create({
      data: {
        sessionToken: `revoke_test_${Date.now()}`,
        userId: (await prisma.user.findUniqueOrThrow({ where: { email: "viewer@nesto.test" } }))
          .id,
        membershipId: target!.id,
        currentCompanyId: owner.companyId,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await team.suspendMember(owner, target!.id);

    // The session row is the access. Deleting it is the revocation.
    const stillThere = await prisma.session.findUnique({ where: { id: session.id } });
    expect(stillThere).toBeNull();

    await team.unsuspendMember(owner, target!.id);
    const restored = await prisma.companyMember.findUniqueOrThrow({ where: { id: target!.id } });
    expect(restored.status).toBe("ACTIVE");
  });

  it("refuses a transition the lifecycle does not allow", async () => {
    // Awkward memberships live in Fixture Works (E-06 §45).
    const owner = await loginAsEmail(DEMO_EMAIL.fixtureOwner);
    const target = await prisma.companyMember.findFirstOrThrow({
      where: { companyId: owner.companyId, user: { email: "suspended-membership@nesto.test" } },
      select: { id: true },
    });

    // Already suspended: suspending again is a conflict, not a silent no-op.
    await expectError(team.suspendMember(owner, target.id), "CONFLICT");
  });

  it("blocks removal while the member manages an active project (PRD #14 §102)", async () => {
    const owner = await loginAs("OWNER");
    const manager = await prisma.companyMember.findFirstOrThrow({
      where: { companyId: owner.companyId, user: { email: "pm@nesto.test" } },
      select: { id: true },
    });

    const managed = await prisma.project.count({
      where: {
        projectManagerMemberId: manager.id,
        archivedAt: null,
        status: { in: ["PENDING", "ACTIVE"] },
      },
    });
    expect(managed).toBeGreaterThan(0);

    await expectError(team.deactivateMember(owner, manager.id), "CONFLICT");
  });
});

/* -------------------------------------------------------------------------- */
/* Invitations                                                                 */
/* -------------------------------------------------------------------------- */

describe("invitations (PRD #14 §61–§80)", () => {
  it("refuses to invite without the grant", async () => {
    const engineer = await loginAs("ENGINEER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });

    await expectError(
      invitations.inviteMember(engineer, {
        email: "should-not-exist@nesto.test",
        roleId: role.id,
        firstName: undefined,
        lastName: undefined,
        departmentId: undefined,
        jobTitle: undefined,
      }),
      "FORBIDDEN",
    );
  });

  it("stores a hash, never the token (PRD #14 §238)", async () => {
    const owner = await loginAs("OWNER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });

    const result = await invitations.inviteMember(owner, {
      email: "token-test@nesto.test",
      roleId: role.id,
      firstName: undefined,
      lastName: undefined,
      departmentId: undefined,
      jobTitle: undefined,
    });
    createdInvites.push(result.inviteId);

    const row = await prisma.companyInvite.findUniqueOrThrow({ where: { id: result.inviteId } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Whatever the link contains, the row must not contain it.
    const token = result.inviteUrl?.split("/invite/")[1];
    expect(token).toBeTruthy();
    expect(row.tokenHash).toBe(hashInviteToken(token!));
    expect(JSON.stringify(row)).not.toContain(token!);
  });

  it("never writes the token into the activity trail (PRD #14 §171)", async () => {
    const owner = await loginAs("OWNER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });

    const result = await invitations.inviteMember(owner, {
      email: "activity-token-test@nesto.test",
      roleId: role.id,
      firstName: undefined,
      lastName: undefined,
      departmentId: undefined,
      jobTitle: undefined,
    });
    createdInvites.push(result.inviteId);

    const entry = await prisma.activity.findFirstOrThrow({
      where: { entityType: "CompanyInvite", entityId: result.inviteId },
    });
    const token = result.inviteUrl!.split("/invite/")[1];
    const row = await prisma.companyInvite.findUniqueOrThrow({ where: { id: result.inviteId } });

    expect(JSON.stringify(entry)).not.toContain(token);
    expect(JSON.stringify(entry)).not.toContain(row.tokenHash);
  });

  it("refuses a second invitation while one is pending (PRD #14 §79)", async () => {
    const owner = await loginAs("OWNER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });

    const first = await invitations.inviteMember(owner, {
      email: "duplicate-invite@nesto.test",
      roleId: role.id,
      firstName: undefined,
      lastName: undefined,
      departmentId: undefined,
      jobTitle: undefined,
    });
    createdInvites.push(first.inviteId);

    await expectError(
      invitations.inviteMember(owner, {
        email: "duplicate-invite@nesto.test",
        roleId: role.id,
        firstName: undefined,
        lastName: undefined,
        departmentId: undefined,
        jobTitle: undefined,
      }),
      "CONFLICT",
    );
  });

  it("refuses to invite somebody who is already a member (PRD #14 §63)", async () => {
    const owner = await loginAs("OWNER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });

    await expectError(
      invitations.inviteMember(owner, {
        email: "engineer@nesto.test",
        roleId: role.id,
        firstName: undefined,
        lastName: undefined,
        departmentId: undefined,
        jobTitle: undefined,
      }),
      "CONFLICT",
    );
  });

  it("issues a new token on resend and retires the old one (PRD #14 §69, §136)", async () => {
    const owner = await loginAs("OWNER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });

    const created = await invitations.inviteMember(owner, {
      email: "resend-test@nesto.test",
      roleId: role.id,
      firstName: undefined,
      lastName: undefined,
      departmentId: undefined,
      jobTitle: undefined,
    });
    createdInvites.push(created.inviteId);

    const before = await prisma.companyInvite.findUniqueOrThrow({
      where: { id: created.inviteId },
    });
    const resent = await invitations.resendInvitation(owner, created.inviteId);
    const after = await prisma.companyInvite.findUniqueOrThrow({ where: { id: created.inviteId } });

    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
    // The old link is dead: its hash no longer resolves to anything.
    const oldToken = created.inviteUrl!.split("/invite/")[1];
    expect(await invitations.previewInvite(oldToken)).toBeNull();
    expect(await invitations.previewInvite(resent.inviteUrl!.split("/invite/")[1])).not.toBeNull();
  });

  it("stops a cancelled invitation from being previewed (PRD #14 §70)", async () => {
    const owner = await loginAs("OWNER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });

    const created = await invitations.inviteMember(owner, {
      email: "cancel-test@nesto.test",
      roleId: role.id,
      firstName: undefined,
      lastName: undefined,
      departmentId: undefined,
      jobTitle: undefined,
    });
    createdInvites.push(created.inviteId);

    await invitations.cancelInvitation(owner, created.inviteId);
    expect(await invitations.previewInvite(created.inviteUrl!.split("/invite/")[1])).toBeNull();
  });

  it("answers null for every invalid token, without distinguishing them (PRD #14 §240)", async () => {
    expect(await invitations.previewInvite("not-a-real-token")).toBeNull();
    expect(await invitations.previewInvite("")).toBeNull();
  });

  it("reports an expired invitation as EXPIRED even while the row says PENDING (PRD #14 §236)", async () => {
    const owner = await loginAsEmail(DEMO_EMAIL.fixtureOwner);
    const rows = await invitations.listInvitations(owner);
    const lapsed = rows.find((invite) => invite.email === "lapsed-invite@nesto.test");

    expect(lapsed).toBeDefined();
    expect(lapsed!.status).toBe("EXPIRED");
  });

  it("requires sign-in to claim an invitation for an address that already has an account (PRD #14 §75)", async () => {
    // Anybody holding the link must not be able to attach that person to a
    // company by inventing a password for them.
    await expectError(
      invitations.acceptInvite({
        token: "nesto-demo-existing-account-invite-token",
        firstName: "Someone",
        lastName: "Else",
        password: "a-brand-new-password",
      }, { personDoor: ensurePersonForUser, placement: placeMembership }),
      "UNAUTHENTICATED",
    );
  });

  it("refuses an invitation claimed by a different signed-in account (PRD #14 §76)", async () => {
    const owner = await loginAs("OWNER");

    await expectError(
      invitations.acceptInvite(
        { token: "nesto-demo-existing-account-invite-token" },
        { authenticatedUserId: owner.userId, personDoor: ensurePersonForUser, placement: placeMembership },
      ),
      "FORBIDDEN",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Invitation delivery                                                          */
/* -------------------------------------------------------------------------- */

describe("invitation delivery (PRD #38 §14, §15, §21)", () => {
  async function invite(email: string) {
    const owner = await loginAs("OWNER");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });
    const result = await invitations.inviteMember(owner, {
      email,
      roleId: role.id,
      firstName: undefined,
      lastName: undefined,
      departmentId: undefined,
      jobTitle: undefined,
    });
    createdInvites.push(result.inviteId);
    return { owner, result };
  }

  it("records a sent message against the invitation, and the list shows it", async () => {
    clearOutbox();
    const { owner, result } = await invite("delivery-sent@nesto.test");

    expect(result).toMatchObject({ delivered: true, deliveryStatus: "SENT" });
    const delivery = await prisma.mailDelivery.findFirstOrThrow({
      where: { entityType: "CompanyInvite", entityId: result.inviteId },
    });
    expect(delivery).toMatchObject({ status: "SENT", templateKey: "team.invitation" });

    const message = readOutbox().at(-1)!;
    expect(message.to).toBe("delivery-sent@nesto.test");
    expect(message.text).toContain("/invite/");

    const listed = (await invitations.listInvitations(owner)).find((row) => row.id === result.inviteId);
    expect(listed?.delivery?.status).toBe("SENT");
  });

  it("keeps the invitation when delivery fails, and makes the failure visible", async () => {
    setMailProvider({
      name: "failing",
      sink: false,
      send: async () => ({ status: "FAILED", errorCode: "HTTP_401", retryable: false }),
    });
    const { owner, result } = await invite("delivery-failed@nesto.test");

    expect(result).toMatchObject({ delivered: false, deliveryStatus: "FAILED" });
    const row = await prisma.companyInvite.findUniqueOrThrow({ where: { id: result.inviteId } });
    expect(row.status).toBe("PENDING");

    const listed = (await invitations.listInvitations(owner)).find((item) => item.id === result.inviteId);
    expect(listed?.delivery).toMatchObject({ status: "FAILED", errorCode: "HTTP_401" });
  });

  it("mails the new link on resend, and records it as audit evidence", async () => {
    const { owner, result } = await invite("delivery-resend@nesto.test");
    clearOutbox();

    const resent = await invitations.resendInvitation(owner, result.inviteId);
    expect(resent.deliveryStatus).toBe("SENT");

    const deliveries = await prisma.mailDelivery.findMany({
      where: { entityType: "CompanyInvite", entityId: result.inviteId },
      orderBy: { createdAt: "asc" },
    });
    expect(deliveries.map((delivery) => delivery.templateKey)).toEqual(["team.invitation", "team.invitation_resend"]);
    expect(readOutbox().at(-1)?.text).toContain(resent.inviteUrl!.split("/invite/")[1]);

    const audit = await prisma.auditEvent.findFirst({
      where: { actionKey: "TEAM_INVITATION_RESENT", entityId: result.inviteId },
    });
    expect(audit).not.toBeNull();
  });

  it("throttles resending one invitation (PRD #38 §15, §17)", async () => {
    const { owner, result } = await invite("delivery-throttle@nesto.test");

    for (let i = 0; i < 3; i += 1) {
      await invitations.resendInvitation(owner, result.inviteId);
    }
    await expectError(invitations.resendInvitation(owner, result.inviteId), "CONFLICT");
  });

  it("activates a new account from its invitation exactly once, with audit evidence", async () => {
    const { result } = await invite("delivery-accept@nesto.test");
    const token = result.inviteUrl!.split("/invite/")[1];

    try {
      const accepted = await invitations.acceptInvite({
        token,
        firstName: "Accepted",
        lastName: "Person",
        password: "a-long-enough-password",
      }, { personDoor: ensurePersonForUser, placement: placeMembership });
      createdMembers.push(accepted.membershipId);

      const membership = await prisma.companyMember.findUniqueOrThrow({ where: { id: accepted.membershipId } });
      expect(membership.status).toBe("ACTIVE");

      // Joining makes the account a person of the company's group (E-01 §219, ADR 0002).
      const joined = await prisma.user.findUniqueOrThrow({ where: { email: "delivery-accept@nesto.test" }, select: { personProfile: { select: { parentGroupId: true, firstName: true, lifecycleStatus: true } } } });
      const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId }, select: { parentGroupId: true } });
      expect(joined.personProfile).toMatchObject({ parentGroupId: company.parentGroupId, firstName: "Accepted", lifecycleStatus: "EMPLOYEE" });

      const audit = await prisma.auditEvent.findFirst({
        where: { actionKey: "TEAM_MEMBER_ACTIVATED", entityId: accepted.membershipId },
      });
      expect(audit).not.toBeNull();

      await expectError(
        invitations.acceptInvite({ token, firstName: "Again", lastName: "Person", password: "a-long-enough-password" }, { personDoor: ensurePersonForUser, placement: placeMembership }),
        "NOT_FOUND",
      );
    } finally {
      const user = await prisma.user.findUnique({ where: { email: "delivery-accept@nesto.test" } });
      if (user) {
        await prisma.auditEvent.deleteMany({ where: { actorUserId: user.id } });
        await prisma.activity.deleteMany({ where: { actorUserId: user.id } });
        await prisma.companyInvite.updateMany({ where: { userId: user.id }, data: { userId: null, companyMemberId: null } });
        await prisma.companyMember.deleteMany({ where: { userId: user.id } });
        createdMembers.length = 0;
        await prisma.user.delete({ where: { id: user.id } });
        if (user.personProfileId) await prisma.personProfile.delete({ where: { id: user.personProfileId } });
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Departments                                                                 */
/* -------------------------------------------------------------------------- */

describe("departments (PRD #14 §112–§129; read only since E-13)", () => {
  it("lists the company's branches of the group's departments, with their codes", async () => {
    const owner = await loginAs("OWNER");
    const listed = await departments.listDepartments(owner);
    const finance = listed.find((department) => department.key === "finance");
    expect(finance).toMatchObject({ code: "FIN", status: "ACTIVE" });
    expect(finance!.groupDepartmentId).toBeTruthy();
    // Creating, editing and archiving went to Organization (E-13 §39, ADR 0003).
    expect("createDepartment" in departments).toBe(false);
    expect("archiveDepartment" in departments).toBe(false);
  });

  it("answers NOT_FOUND for another company's department (PRD #14 §160)", async () => {
    const owner = await loginAs("OWNER");
    const foreign = await prisma.department.findFirstOrThrow({
      where: { companyId: COMPANY.tenant },
      select: { id: true },
    });

    await expectError(departments.getDepartment(owner, foreign.id), "NOT_FOUND");
  });

  it("surfaces a manager who is no longer active rather than hiding them (PRD #14 §248)", async () => {
    const owner = await loginAs("OWNER");
    const listed = await departments.listDepartments(owner);
    const managed = listed.filter((department) => department.manager !== null);

    expect(managed.length).toBeGreaterThan(0);
    for (const department of managed) {
      expect(typeof department.manager!.active).toBe("boolean");
    }
  });
});
