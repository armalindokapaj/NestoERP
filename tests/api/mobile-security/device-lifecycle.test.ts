import { afterAll, describe, expect, it } from "vitest";

import { probeDeviceState, restoreDevice, revokeDevice, signOutDevice, syncDevice, confirmDataRemoval } from "@/lib/auth/device.service";
import { assertRecentAuthentication } from "@/lib/auth/recent-auth";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * The device is not the session (MOB-11 §6-§30): revocation ends access on the
 * server, and the removal instruction is what a signed-out app can still ask.
 */
const installs: string[] = [];
const install = () => {
  const id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  installs.push(id);
  return id;
};
const report = (installId: string, appVersion = "9.9.9") => ({ installId, platform: "ios" as const, appVersion, appBuild: "1", osVersion: "17.2", reportedRisk: [] });

afterAll(async () => {
  await prisma.deviceRegistration.deleteMany({ where: { installId: { in: installs } } });
  await cleanupSessions();
});

describe("device lifecycle", () => {
  it("registers once per install and binds the session to the device", async () => {
    const ctx = await loginAs("ENGINEER");
    const id = install();
    const state = await syncDevice(ctx, report(id));
    await syncDevice(ctx, report(id));
    const rows = await prisma.deviceRegistration.findMany({ where: { installId: id } });
    expect(rows).toHaveLength(1);
    expect(state.device.status).toBe("ACTIVE");
    expect(rows[0].userId).toBe(ctx.userId);
  });

  it("revoking ends the device's sessions and queues a cache removal", async () => {
    const ctx = await loginAs("ENGINEER");
    const id = install();
    await syncDevice(ctx, report(id));
    const device = await prisma.deviceRegistration.findFirstOrThrow({ where: { installId: id } });
    await prisma.session.update({ where: { id: ctx.sessionId! }, data: { deviceId: device.id } });

    const result = await prisma.$transaction((tx) => revokeDevice(tx, { deviceId: device.id, actorUserId: ctx.userId, actorCompanyId: ctx.companyId, kind: "REVOKE" }));
    expect(result.sessionsEnded).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.count({ where: { id: ctx.sessionId! } })).toBe(0);
    const after = await prisma.deviceRegistration.findUniqueOrThrow({ where: { id: device.id } });
    expect(after.status).toBe("REVOKED");
    expect(after.dataRemovalMode).toBe("CACHE_ONLY");
    expect(after.pushToken).toBeNull();
  });

  it("a lost or blocked device is told to remove everything, and the app can ask without a session", async () => {
    const ctx = await loginAs("PROJECT_MANAGER");
    const id = install();
    await syncDevice(ctx, report(id));
    const device = await prisma.deviceRegistration.findFirstOrThrow({ where: { installId: id } });
    await prisma.$transaction((tx) => revokeDevice(tx, { deviceId: device.id, actorUserId: ctx.userId, actorCompanyId: ctx.companyId, kind: "LOST" }));

    const probe = await probeDeviceState(id, [ctx.userId]);
    expect(probe).toHaveLength(1);
    expect(probe[0].status).toBe("REVOKED");
    expect(probe[0].dataRemoval?.mode).toBe("FULL");
    expect(await probeDeviceState(id, ["someone-else"])).toEqual([]);
    expect(await probeDeviceState("not-an-install-id", [ctx.userId])).toEqual([]);

    expect(await confirmDataRemoval(id, ctx.userId)).toBe(true);
    expect((await probeDeviceState(id, [ctx.userId]))[0].dataRemoval).toBeNull();
  });

  it("restoring lets the install sign in again and cancels the removal", async () => {
    const ctx = await loginAs("ENGINEER");
    const id = install();
    await syncDevice(ctx, report(id));
    const device = await prisma.deviceRegistration.findFirstOrThrow({ where: { installId: id } });
    await prisma.$transaction((tx) => revokeDevice(tx, { deviceId: device.id, actorUserId: ctx.userId, actorCompanyId: ctx.companyId, kind: "BLOCK" }));
    await prisma.$transaction((tx) => restoreDevice(tx, device.id));
    const after = await prisma.deviceRegistration.findUniqueOrThrow({ where: { id: device.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.dataRemovalMode).toBe("NONE");
  });

  it("signing a device out keeps it registered", async () => {
    const ctx = await loginAs("ENGINEER");
    const id = install();
    await syncDevice(ctx, report(id));
    const device = await prisma.deviceRegistration.findFirstOrThrow({ where: { installId: id } });
    await prisma.$transaction((tx) => signOutDevice(tx, device.id));
    expect((await prisma.deviceRegistration.findUniqueOrThrow({ where: { id: device.id } })).status).toBe("ACTIVE");
  });

  it("an app below the minimum version is reported as needing an update", async () => {
    const ctx = await loginAs("ENGINEER");
    const state = await syncDevice(ctx, report(install(), "0.0.1"));
    expect(state.compliance.action).toBe("REQUIRE_UPDATE");
  });
});

describe("recent authentication", () => {
  it("is satisfied right after sign-in and refused once the window has passed", async () => {
    const ctx = await loginAs("OWNER");
    await expect(assertRecentAuthentication(ctx)).resolves.toBeUndefined();
    await prisma.session.update({ where: { id: ctx.sessionId! }, data: { recentAuthAt: new Date(Date.now() - 3 * 3_600_000) } });
    await expect(assertRecentAuthentication(ctx)).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });
});
