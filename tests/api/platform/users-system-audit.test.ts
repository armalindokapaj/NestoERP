import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { revokeUserSessions, sendUserPasswordReset, setUserStatus } from "@/lib/modules/platform/platform-control.service";
import { exportAuditLog, getAuditLogEvent, listAuditLog } from "@/lib/modules/platform/platform-audit.query";
import { sendTestEmail } from "@/lib/modules/platform/platform-system.service";
import { getPlatformUser, listUsersDirectory } from "@/lib/modules/platform/platform-users.query";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Platform Admin users, system and audit (Admin Users/System/Audit PRD #6
 * §3-§8, §23, §26-§29, §40-§41, §50, §61-§73).
 */

const PREFIX = "t-adm6.";
let admin: PlatformContext;
let userId: string;
let probeAdminId: string;

async function sweep() {
  const ids = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((row) => row.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ entityType: "User", entityId: { in: ids } }, { entityType: "PlatformTestEmail", entityLabelSnapshot: "Test email" }] } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.authEvent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.platformAccess.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function makeUser(suffix: string, extra: object = {}) {
  const hash = (await prisma.user.findFirstOrThrow({ select: { passwordHash: true } })).passwordHash;
  return prisma.user.create({ data: { username: `${PREFIX}${suffix}`, firstName: "Adm6", lastName: suffix, passwordHash: hash, ...extra }, select: { id: true } });
}

beforeAll(async () => {
  await sweep();
  admin = await loginAsPlatformAdmin();
  ({ id: userId } = await makeUser("probe", { recoveryEmail: "adm6.probe@example.com", recoveryEmailVerifiedAt: new Date() }));
  ({ id: probeAdminId } = await makeUser("admin", { platformAccess: { create: { roleKey: "PLATFORM_ADMIN" } } }));
});

afterAll(async () => {
  await sweep();
  await cleanupSessions();
});

describe("users directory (§3-§8)", () => {
  it("finds an account by username and shows it has no access", async () => {
    const result = await listUsersDirectory(admin, { q: `${PREFIX}probe` });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: userId, scope: "—", status: "ACTIVE" });
    expect((await listUsersDirectory(admin, { q: PREFIX, scope: "platform" })).rows.map((row) => row.id)).toEqual([probeAdminId]);
    expect((await listUsersDirectory(admin, { q: PREFIX, status: "SUSPENDED" })).total).toBe(0);
  });

  it("never reads a password or token onto the detail page", async () => {
    const user = await getPlatformUser(admin, userId);
    expect(JSON.stringify(user)).not.toMatch(/passwordHash|\$argon|\$2[aby]\$/);
    expect(user.recoveryEmail).not.toBe("adm6.probe@example.com");
  });
});

describe("account security actions", () => {
  it("signs a user out everywhere and records it (§40, §41)", async () => {
    await prisma.session.create({ data: { userId, sessionToken: `${PREFIX}${Date.now()}`, expiresAt: new Date(Date.now() + 3_600_000) } });
    expect(await revokeUserSessions(admin, userId, "Lost laptop")).toEqual({ revoked: 1 });
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityId: userId, actionKey: "PLATFORM_USER_SIGNED_OUT_EVERYWHERE" } })).toBe(1);
  });

  it("sends a reset link to the verified recovery address only (§26-§29)", async () => {
    const { sentTo } = await sendUserPasswordReset(admin, userId);
    expect(sentTo).not.toContain("adm6.probe@");
    const { id: bare } = await makeUser("bare");
    await expect(sendUserPasswordReset(admin, bare)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("can suspend a Platform Admin while another active one remains (§23)", async () => {
    await setUserStatus(admin, probeAdminId, "SUSPENDED", "Offboarding");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: probeAdminId } })).status).toBe("SUSPENDED");
    await expect(setUserStatus(admin, admin.userId, "SUSPENDED", "Self")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("system", () => {
  it("sends a test email and records the outcome (§50)", async () => {
    const outcome = await sendTestEmail(admin, { to: "adm6.test@example.com" });
    expect(typeof outcome.status).toBe("string");
    await expect(sendTestEmail(admin, { to: "not an address" })).rejects.toThrow();
  });
});

describe("audit log (§61-§73)", () => {
  it("filters on the server and opens one event with its snapshots", async () => {
    const result = await listAuditLog(admin, { action: "user signed out everywhere", q: "Adm6" });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((row) => row.actionKey === "PLATFORM_USER_SIGNED_OUT_EVERYWHERE")).toBe(true);
    const event = await getAuditLogEvent(admin, result.rows[0].id);
    expect(event.after).toMatchObject({ sessionsRevoked: 1 });
    expect((await listAuditLog(admin, { from: "2000-01-01", to: "2000-01-02" })).total).toBe(0);
    expect((await listAuditLog(admin, { page: "abc", severity: "NOPE" })).filter).toMatchObject({ page: 1, severity: "" });
  });

  it("exports the filtered log as CSV that a spreadsheet cannot run as a formula", async () => {
    await prisma.auditEvent.updateMany({ where: { entityId: userId, actionKey: "PLATFORM_USER_SIGNED_OUT_EVERYWHERE" }, data: { reason: "=HYPERLINK(\"x\")" } });
    const { csv, truncated } = await exportAuditLog(admin, { entity: "User", q: "Adm6" });
    expect(truncated).toBe(false);
    expect(csv.split("\n")[0]).toContain("\"Time (UTC)\"");
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).not.toMatch(/,"=HYPERLINK/);
  });
});
