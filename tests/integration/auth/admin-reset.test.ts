import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateCredentials } from "@/lib/auth/credentials";
import { clearThrottle } from "@/lib/core/security/throttle";
import { resetMemberPassword } from "@/lib/modules/team/team.service";
import { generateTemporaryPassword } from "@/lib/auth/temporary-password";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";

/**
 * Account recovery without email (PRD #50 §18, §20-§23, §325).
 *
 * This is the whole of it in V0.1: an administrator issues a temporary
 * password and passes it on out of band. Nothing here sends a message, and an
 * installation with no mail transport configured recovers accounts exactly the
 * same way.
 */

const made: string[] = [];

async function memberToReset(username: string) {
  const template = await prisma.user.findFirstOrThrow({
    where: { username: "engineer-a" },
    select: { passwordHash: true, memberships: { where: { status: "ACTIVE" }, take: 1, select: { companyId: true, roleId: true, departmentId: true } } },
  });
  const seat = template.memberships[0];
  const user = await prisma.user.create({
    data: {
      username,
      email: null,
      firstName: "Reset",
      lastName: "Probe",
      passwordHash: template.passwordHash,
      memberships: { create: { companyId: seat.companyId, roleId: seat.roleId, departmentId: seat.departmentId, status: "ACTIVE" } },
    },
    select: { id: true, memberships: { select: { id: true } } },
  });
  made.push(user.id);
  return { userId: user.id, memberId: user.memberships[0].id };
}

async function sweep() {
  const stale = await prisma.user.findMany({ where: { username: { startsWith: "reset." } }, select: { id: true } });
  const ids = stale.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { actionKey: "TEAM_MEMBER_PASSWORD_RESET", entityLabelSnapshot: { startsWith: "reset." } } });
  await prisma.companyMember.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(sweep);
afterAll(async () => {
  await sweep();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("a temporary password", () => {
  it("is long, unguessable, and free of characters people misread down a phone", () => {
    const passwords = Array.from({ length: 200 }, () => generateTemporaryPassword());
    for (const password of passwords) {
      expect(password).toMatch(/^[a-zA-Z2-9-]{19}$/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
    // 200 of them and no repeat: generated, not chosen.
    expect(new Set(passwords).size).toBe(200);
  });
});

describe("an administrator resetting somebody's password", () => {
  it("hands back a password that signs the account in, and demands it be changed", async () => {
    const context = await loginAs("OWNER");
    const { memberId } = await memberToReset("reset.works");

    const result = await resetMemberPassword(context, memberId);
    expect(result.username).toBe("reset.works");
    await clearThrottle("AUTH_LOGIN", { account: "reset.works" });

    const signedIn = await authenticateCredentials({ username: "reset.works", password: result.temporaryPassword }, null);
    expect(signedIn?.mustChangePassword).toBe(true);
  });

  it("signs the account out everywhere, including whoever the reset is protecting against (§44)", async () => {
    const context = await loginAs("OWNER");
    const { userId, memberId } = await memberToReset("reset.revokes");

    await prisma.session.createMany({
      data: [1, 2, 3].map((n) => ({
        sessionToken: `reset_probe_${n}_${Date.now()}`,
        userId,
        membershipId: memberId,
        currentCompanyId: context.companyId,
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
    });

    const result = await resetMemberPassword(context, memberId);
    expect(result.sessionsRevoked).toBe(3);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  it("makes the old password stop working", async () => {
    const context = await loginAs("OWNER");
    const { memberId } = await memberToReset("reset.invalidates");
    const old = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";

    await resetMemberPassword(context, memberId);
    await clearThrottle("AUTH_LOGIN", { account: "reset.invalidates" });

    expect(await authenticateCredentials({ username: "reset.invalidates", password: old }, null)).toBeNull();
  });

  it("writes an audit record that carries no password and no hash (§23)", async () => {
    const context = await loginAs("OWNER");
    const { memberId } = await memberToReset("reset.audited");

    const result = await resetMemberPassword(context, memberId);
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { actionKey: "TEAM_MEMBER_PASSWORD_RESET", entityId: memberId },
      orderBy: { occurredAt: "desc" },
    });

    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain(result.temporaryPassword);
    expect(serialised).not.toContain("passwordHash");
    expect(serialised).toContain("reset.audited");
  });

  it("refuses somebody without the permission (§21, §22)", async () => {
    const context = await loginAs("ENGINEER");
    const { memberId } = await memberToReset("reset.forbidden");
    await expect(resetMemberPassword(context, memberId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses to reset your own, which is the change-password flow (§22)", async () => {
    const context = await loginAs("OWNER");
    await expect(resetMemberPassword(context, context.membershipId)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("will not reach another company's member", async () => {
    const context = await loginAs("OWNER");
    const foreign = await prisma.companyMember.findFirstOrThrow({
      where: { companyId: COMPANY.tenant },
      select: { id: true },
    });
    await expect(resetMemberPassword(context, foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
