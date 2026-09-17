import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateCredentials } from "@/lib/auth/credentials";
import { setTemporaryPassword } from "@/lib/auth/identity";
import { temporaryPasswordExpiry } from "@/lib/auth/temporary-password";
import { hashPassword } from "@/lib/auth/password";
import { clearThrottle } from "@/lib/core/security/throttle";
import { cleanupSessions, prisma } from "../../helpers";

/**
 * Local username/password sign-in (PRD #50 §6, §17, §24, §325).
 *
 * The acceptance test the PRD actually asks for is a negative one: nothing in
 * the way in reads an address, and an account with no address at all behaves
 * exactly like one that has one.
 */

const PASSWORD = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";
const made: string[] = [];

async function account(username: string, options: { email?: string | null } = {}) {
  const template = await prisma.user.findFirstOrThrow({
    where: { username: "engineer-a" },
    select: { passwordHash: true, memberships: { where: { status: "ACTIVE" }, take: 1, select: { companyId: true, roleId: true, departmentId: true } } },
  });
  const membership = template.memberships[0];
  const user = await prisma.user.create({
    data: {
      username,
      email: options.email === undefined ? `${username}@probe.test` : options.email,
      firstName: "Probe",
      lastName: "Account",
      passwordHash: template.passwordHash,
      memberships: { create: { companyId: membership.companyId, roleId: membership.roleId, departmentId: membership.departmentId, status: "ACTIVE" } },
    },
    select: { id: true },
  });
  made.push(user.id);
  await clearThrottle("AUTH_LOGIN", { account: username });
  return user;
}

/** Anything a previous interrupted run left behind, so this one can start clean. */
async function sweepProbes() {
  const stale = await prisma.user.findMany({ where: { username: { startsWith: "probe." } }, select: { id: true } });
  const ids = stale.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.companyMember.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(sweepProbes);

afterAll(async () => {
  // The sign-ins above created real sessions and memberships against these
  // accounts; both point at the user row and have to go first.
  await sweepProbes();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("signing in", () => {
  it("accepts the username and the password", async () => {
    await account("probe.plain");
    const result = await authenticateCredentials({ username: "probe.plain", password: PASSWORD }, null);
    expect(result?.username).toBe("probe.plain");
  });

  it("accepts it however it was typed", async () => {
    await account("probe.typed");
    const result = await authenticateCredentials({ username: "  PROBE.Typed  ", password: PASSWORD }, null);
    expect(result?.username).toBe("probe.typed");
  });

  it("refuses the email address, which is no longer an identifier (§6, §66)", async () => {
    await account("probe.byemail");
    expect(await authenticateCredentials({ username: "probe.byemail@probe.test", password: PASSWORD }, null)).toBeNull();
  });

  it("signs in an account that has no email at all (§325)", async () => {
    await account("probe.noemail", { email: null });
    const result = await authenticateCredentials({ username: "probe.noemail", password: PASSWORD }, null);
    expect(result?.username).toBe("probe.noemail");
  });

  it("refuses the wrong password", async () => {
    await account("probe.wrongpw");
    expect(await authenticateCredentials({ username: "probe.wrongpw", password: "not-the-password" }, null)).toBeNull();
  });

  it("answers the same way for an account that does not exist (§24)", async () => {
    // Failures against a name nobody holds still count toward the lockout, by
    // design — so an earlier run's attempts must be cleared or this asserts
    // the throttle rather than the answer.
    await clearThrottle("AUTH_LOGIN", { account: "nobody.at.all" });
    expect(await authenticateCredentials({ username: "nobody.at.all", password: PASSWORD }, null)).toBeNull();
  });
});

describe("temporary passwords", () => {
  it("say the holder must choose their own (§16, §270)", async () => {
    const user = await account("probe.temporary");
    await prisma.$transaction((tx) => setTemporaryPassword(tx, user.id, "Temp-Pass-1234", temporaryPasswordExpiry()));

    const result = await authenticateCredentials({ username: "probe.temporary", password: "Temp-Pass-1234" }, null);
    expect(result?.mustChangePassword).toBe(true);
  });

  it("stop working once they lapse, used or not (§17)", async () => {
    const user = await account("probe.lapsed");
    const past = new Date(Date.now() - 60_000);
    await prisma.$transaction((tx) => setTemporaryPassword(tx, user.id, "Temp-Pass-5678", past));

    expect(await authenticateCredentials({ username: "probe.lapsed", password: "Temp-Pass-5678" }, null)).toBeNull();
  });

  it("are replaced by a password of the holder's own, which clears the obligation (§19)", async () => {
    const user = await account("probe.replaced");
    await prisma.$transaction((tx) => setTemporaryPassword(tx, user.id, "Temp-Pass-9012", temporaryPasswordExpiry()));

    // What `setPassword` does when somebody chooses their own.
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(PASSWORD), mustChangePassword: false, temporaryPasswordExpiresAt: null },
    });
    await clearThrottle("AUTH_LOGIN", { account: "probe.replaced" });

    const result = await authenticateCredentials({ username: "probe.replaced", password: PASSWORD }, null);
    expect(result?.mustChangePassword).toBe(false);
  });
});

describe("the database", () => {
  it("refuses two accounts with one username", async () => {
    await account("probe.unique");
    await expect(account("probe.unique")).rejects.toThrow();
  });

  it("allows many accounts with no email (§67)", async () => {
    await account("probe.blank.one", { email: null });
    await account("probe.blank.two", { email: null });
    const blanks = await prisma.user.count({ where: { id: { in: made }, email: null } });
    expect(blanks).toBeGreaterThanOrEqual(2);
  });
});
