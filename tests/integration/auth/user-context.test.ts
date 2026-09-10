import { afterAll, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { revokeSession } from "@/lib/auth/session-store";
import { ROLE_KEYS } from "@/config/roles";
import { cleanupSessions, createRawSession, loginAs, prisma, resolveSession } from "../../helpers";

/**
 * User-context and session integration tests (PRD #9 §139, §140).
 *
 * These run against the real database. A disabled user, membership or company
 * must lose access on the next request, not when a token happens to expire
 * (PRD #6 §113–§115).
 */
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("context resolution", () => {
  it("resolves a context for all 16 demo accounts", async () => {
    for (const role of ROLE_KEYS) {
      const context = await loginAs(role);
      expect(context.role, role).toBe(role);
      expect(context.company.name).toBe("NESTO Demo Construction");
      expect(context.permissions.length).toBeGreaterThan(0);
    }
  });

  it("maps the session to the right user, membership and company", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    const session = await prisma.session.findUnique({
      where: { id: context.sessionId },
      include: { membership: true },
    });

    expect(session).not.toBeNull();
    expect(session!.userId).toBe(context.userId);
    expect(session!.membershipId).toBe(context.membershipId);
    expect(session!.currentCompanyId).toBe(context.companyId);
    expect(session!.membership.companyId).toBe(context.companyId);
  });

  it("refuses a session id that does not belong to the claimed user", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");

    const result = await resolveSession(pm.sessionId, architect.userId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("SESSION_EXPIRED");
  });

  it("refuses an unknown session id", async () => {
    const result = await resolveSession("session_does_not_exist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("SESSION_EXPIRED");
  });

  it("refuses an expired session (PRD #6 §51)", async () => {
    const { session, user } = await createRawSession("viewer@nesto.test");
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await resolveSession(session.id, user.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("SESSION_EXPIRED");
  });

  it("refuses a session once it has been revoked (PRD #6 §53)", async () => {
    const context = await loginAs("VIEWER");
    await revokeSession(context.sessionId);

    const result = await resolveSession(context.sessionId, context.userId);
    expect(result.ok).toBe(false);
  });
});

describe("account and membership state (PRD #9 §139)", () => {
  it("blocks an inactive user", async () => {
    const { session, user } = await createRawSession("inactive-user@nesto.test");
    const result = await resolveSession(session.id, user.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("USER_INACTIVE");
  });

  it("blocks a suspended user", async () => {
    const { session, user } = await createRawSession("suspended-user@nesto.test");
    const result = await resolveSession(session.id, user.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("USER_INACTIVE");
  });

  it("blocks an inactive membership", async () => {
    const { session, user } = await createRawSession("inactive-membership@nesto.test");
    const result = await resolveSession(session.id, user.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MEMBERSHIP_INACTIVE");
  });

  it("blocks a suspended membership", async () => {
    const { session, user } = await createRawSession("suspended-membership@nesto.test");
    const result = await resolveSession(session.id, user.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MEMBERSHIP_INACTIVE");
  });

  it("blocks a member of a suspended company", async () => {
    const { session, user } = await createRawSession("suspended-company@nesto.test");
    const result = await resolveSession(session.id, user.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("COMPANY_UNAVAILABLE");
  });

  it("loses access the moment a membership is disabled (PRD #6 §113)", async () => {
    const context = await loginAs("ENGINEER");
    expect((await resolveSession(context.sessionId, context.userId)).ok).toBe(true);

    await prisma.companyMember.update({
      where: { id: context.membershipId },
      data: { status: "INACTIVE" },
    });

    try {
      const after = await resolveSession(context.sessionId, context.userId);
      expect(after.ok).toBe(false);
      if (!after.ok) expect(after.reason).toBe("MEMBERSHIP_INACTIVE");
    } finally {
      await prisma.companyMember.update({
        where: { id: context.membershipId },
        data: { status: "ACTIVE" },
      });
    }
  });
});

describe("multi-company membership (PRD #9 §30, §165)", () => {
  it("holds a different role in each company", async () => {
    const memberships = await prisma.companyMember.findMany({
      where: { user: { email: "multicompany@nesto.test" } },
      include: { company: true, role: true },
    });

    expect(memberships).toHaveLength(2);

    const byCompany = Object.fromEntries(
      memberships.map((membership) => [membership.company.slug, membership.role.key]),
    );

    expect(byCompany["nesto-demo-construction"]).toBe("ARCHITECT");
    expect(byCompany["nesto-second-company"]).toBe("PROJECT_MANAGER");
  });
});

describe("password hashing (PRD #6 §29)", () => {
  it("never stores a password in the clear", async () => {
    const user = await prisma.user.findUnique({ where: { email: "owner@nesto.test" } });
    expect(user!.passwordHash).not.toBe("nesto1234");
    expect(user!.passwordHash.length).toBeGreaterThan(30);
  });

  it("verifies a correct password and refuses a wrong one", async () => {
    const hash = await hashPassword("a-strong-password");
    expect(await verifyPassword("a-strong-password", hash)).toBe(true);
    expect(await verifyPassword("a-strong-passwore", hash)).toBe(false);
  });
});
