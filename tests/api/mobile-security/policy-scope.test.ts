import { afterAll, describe, expect, it } from "vitest";

import { listDevices, savePolicy } from "@/lib/modules/security/security.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/** Who may edit which level, and that a lower level cannot weaken a higher one (MOB-11 §74, §168, §183). */
afterAll(async () => {
  await prisma.mobileSecurityPolicy.deleteMany({ where: { scopeKey: { startsWith: "COMPANY:" }, updatedBy: { is: null } } }).catch(() => undefined);
  await cleanupSessions();
});

describe("saving a policy level", () => {
  it("lets an owner tighten their own company and refuses a weaker value than the group's", async () => {
    const owner = await loginAs("OWNER");
    const target = { scope: "COMPANY" as const, id: owner.companyId };
    const before = await prisma.mobileSecurityPolicy.findUnique({ where: { scopeKey: `COMPANY:${owner.companyId}` } });
    try {
      const saved = await savePolicy(owner, target, { appLockRequired: true, offlineAuthorizationHours: 24 });
      expect(saved.version).toBeGreaterThanOrEqual(1);
      await expect(savePolicy(owner, target, { offlineAuthorizationHours: 9999 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    } finally {
      if (before) await prisma.mobileSecurityPolicy.update({ where: { id: before.id }, data: { settings: before.settings as never, version: before.version } });
      else await prisma.mobileSecurityPolicy.deleteMany({ where: { scopeKey: `COMPANY:${owner.companyId}` } });
    }
  });

  it("answers a company outside the caller's scope as if it did not exist", async () => {
    const owner = await loginAs("OWNER");
    const other = await prisma.company.findFirstOrThrow({ where: { id: { not: owner.companyId }, parentGroupId: { not: owner.parentGroupId } }, select: { id: true } });
    await expect(savePolicy(owner, { scope: "COMPANY", id: other.id }, { appLockRequired: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses roles without the policy permission", async () => {
    const engineer = await loginAs("ENGINEER");
    await expect(savePolicy(engineer, { scope: "COMPANY", id: engineer.companyId }, { appLockRequired: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listDevices(engineer)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("device administration scope", () => {
  it("lists only devices of people in the administrator's own company", async () => {
    const owner = await loginAs("OWNER");
    const { rows } = await listDevices(owner);
    const inScope = await prisma.companyMember.findMany({ where: { companyId: owner.companyId }, select: { userId: true } });
    const ids = new Set(inScope.map((m) => m.userId));
    for (const row of rows) expect(ids.has(row.user.id)).toBe(true);
  });
});
