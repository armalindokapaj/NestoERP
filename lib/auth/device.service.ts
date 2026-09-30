import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { evaluateDeviceCompliance, type ComplianceResult } from "@/lib/core/security/device-compliance";
import type { EffectiveMobilePolicy } from "@/lib/core/security/mobile-policy.schema";
import { effectivePolicyForUser } from "@/lib/core/security/mobile-policy.service";
import { AccessError } from "@/lib/access/guards";
import type { DeviceSecurityState } from "@/lib/device/security-types";
import { recordAuthEvent } from "./events";
import { revokeSessions } from "./session-store";

/**
 * Devices (MOB-08 §34-§36, MOB-11 §6-§22, §62-§64).
 *
 * `DeviceRegistration` is the canonical Device: one installed NESTO app for one
 * person, identified by the random `installId` the app made for itself. It is
 * not a session — a session ends, the device stays on record with its
 * compliance, revocation and data-removal state — and it is not an identity:
 * every operation here is keyed by a user id the server already authenticated,
 * so nobody can register, read or remove another person's device. A push token
 * that moves to a different person (shared tablet) is re-parented, not
 * duplicated.
 */

const INSTALL_ID = /^[A-Za-z0-9-]{16,64}$/;

export const registerDeviceSchema = z.object({
  platform: z.enum(["ios", "android"]),
  pushToken: z.string().trim().min(16).max(4096),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  appBuild: z.string().regex(/^\d{1,9}$/).optional(),
  installId: z.string().regex(INSTALL_ID).optional(),
});

export const unregisterDeviceSchema = z.object({
  pushToken: z.string().trim().min(16).max(4096),
});

/** What the app tells the server about itself, at sign-in, resume and on a timer (MOB-11 §11, §127). */
export const deviceReportSchema = z.object({
  installId: z.string().regex(INSTALL_ID),
  platform: z.enum(["ios", "android"]),
  deviceName: z.string().trim().min(1).max(80).optional(),
  deviceClass: z.enum(["PHONE", "TABLET"]).optional(),
  osVersion: z.string().regex(/^\d+(\.\d+){0,3}$/).optional(),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  appBuild: z.string().regex(/^\d{1,9}$/).optional(),
  /** Hints only. The server never treats a client-reported signal as proof (MOB-11 §13, §65). */
  reportedRisk: z.array(z.enum(["ROOTED", "JAILBROKEN", "EMULATOR", "DEBUGGABLE"])).max(4).optional(),
  appLockEnabled: z.boolean().optional(),
  policyVersion: z.string().max(32).optional(),
});
export type DeviceReport = z.infer<typeof deviceReportSchema>;

/** Seen at most this often writes the row again when nothing changed (MOB-11 §14). */
export const DEVICE_TOUCH_INTERVAL_MS = 5 * 60_000;
/** An ACTIVE device not seen for this long is shown as STALE (MOB-11 §8). */
export const DEVICE_STALE_AFTER_MS = 60 * 24 * 3_600_000;

const platformOf = (platform: "ios" | "android") => (platform === "ios" ? ("IOS" as const) : ("ANDROID" as const));

/**
 * Registers the calling app install for push (MOB-08 §34). The person's own
 * device, in any workspace. A device an administrator revoked or blocked does
 * not get a push token back.
 */
export async function registerDevice(context: UserContext, input: z.infer<typeof registerDeviceSchema>): Promise<{ id: string }> {
  const base = {
    userId: context.userId,
    sessionId: context.sessionId || null,
    platform: platformOf(input.platform),
    appVersion: input.appVersion,
    appBuild: input.appBuild ?? null,
    enabled: true,
    lastSeenAt: new Date(),
  };
  return prisma.$transaction(async (tx) => {
    if (input.installId) {
      const existing = await tx.deviceRegistration.findUnique({ where: { userId_installId: { userId: context.userId, installId: input.installId } }, select: { id: true, status: true } });
      if (existing && existing.status !== "ACTIVE") throw new AccessError("DEVICE_REVOKED");
      // The token belongs to this install now; whoever held it before loses delivery, keeps their device record.
      await tx.deviceRegistration.updateMany({ where: { pushToken: input.pushToken, NOT: { userId: context.userId, installId: input.installId } }, data: { pushToken: null, enabled: false } });
      return tx.deviceRegistration.upsert({
        where: { userId_installId: { userId: context.userId, installId: input.installId } },
        create: { ...base, installId: input.installId, pushToken: input.pushToken },
        update: { ...base, pushToken: input.pushToken },
        select: { id: true },
      });
    }
    // A build that predates install ids (MOB-08/10): keyed by the token alone, as before.
    const held = await tx.deviceRegistration.findUnique({ where: { pushToken: input.pushToken }, select: { userId: true, status: true } });
    if (held && held.userId === context.userId && held.status !== "ACTIVE") throw new AccessError("DEVICE_REVOKED");
    return tx.deviceRegistration.upsert({
      where: { pushToken: input.pushToken },
      create: { ...base, pushToken: input.pushToken },
      update: base,
      select: { id: true },
    });
  });
}

/**
 * Turns delivery off for this token. The device record stays (history, status);
 * signing out must be idempotent, so not finding it is success.
 */
export async function unregisterDevice(context: UserContext, pushToken: string): Promise<void> {
  await prisma.deviceRegistration.updateMany({ where: { pushToken, userId: context.userId }, data: { pushToken: null, enabled: false } });
}

/**
 * The devices a notification may be pushed to: active, enabled, and registered
 * by a session that is still live — so a revoked or expired session stops
 * receiving pushes without anything having to remember to disable it.
 */
export async function pushableDevices(userIds: string[]): Promise<Array<{ id: string; userId: string; platform: "IOS" | "ANDROID"; pushToken: string }>> {
  if (userIds.length === 0) return [];
  const rows = await prisma.deviceRegistration.findMany({
    where: { userId: { in: userIds }, enabled: true, status: "ACTIVE", pushToken: { not: null }, session: { is: { expiresAt: { gt: new Date() } } } },
    select: { id: true, userId: true, platform: true, pushToken: true },
  });
  return rows.flatMap((row) => (row.pushToken ? [{ ...row, pushToken: row.pushToken }] : []));
}

/**
 * Switches a device off after its push provider said the token is dead
 * (MOB-10 §35, §116). The registration stays, disabled, so history holds; a
 * fresh registration from the app re-enables it with the new token.
 */
export async function disableDevice(deviceId: string): Promise<void> {
  await prisma.deviceRegistration.updateMany({ where: { id: deviceId }, data: { enabled: false } });
}

/** The device a queued push is about, as it stands right now, for the send-time re-check. */
export async function pushableDevice(deviceId: string, userId: string): Promise<{ pushToken: string; platform: "IOS" | "ANDROID" } | null> {
  const row = await prisma.deviceRegistration.findFirst({
    where: { id: deviceId, userId, enabled: true, status: "ACTIVE", pushToken: { not: null }, session: { is: { expiresAt: { gt: new Date() } } } },
    select: { pushToken: true, platform: true },
  });
  return row?.pushToken ? { pushToken: row.pushToken, platform: row.platform } : null;
}

/* -------------------------------------------------------------------------- */
/* Registration and refresh                                                    */
/* -------------------------------------------------------------------------- */

export type { DeviceSecurityState };

function sameReport(row: { osVersion: string | null; appVersion: string; appBuild: string | null; appLockEnabled: boolean | null; reportedRisk: string[]; policyVersion: string | null; sessionId: string | null }, report: DeviceReport, policyVersion: string, sessionId: string) {
  return (
    row.sessionId === sessionId &&
    row.appVersion === report.appVersion &&
    row.appBuild === (report.appBuild ?? null) &&
    row.osVersion === (report.osVersion ?? null) &&
    row.appLockEnabled === (report.appLockEnabled ?? null) &&
    row.policyVersion === policyVersion &&
    [...row.reportedRisk].sort().join() === [...(report.reportedRisk ?? [])].sort().join()
  );
}

/**
 * The one call the app makes after sign-in and then on resume, on reconnecting
 * and on a timer (MOB-11 §11, §127): registers the install if it is new,
 * refreshes what the app says about itself, binds the signed-in session to the
 * device, re-evaluates compliance against the effective policy, and answers
 * with that policy and the device's standing. The user id is the session's —
 * nothing in the body can name another person (§12).
 *
 * Writes are throttled (§14): an unchanged device seen within five minutes
 * costs no write.
 */
export async function syncDevice(context: UserContext, report: DeviceReport, now: number = Date.now()): Promise<DeviceSecurityState> {
  const policy = await effectivePolicyForUser(context.userId);
  const existing = await prisma.deviceRegistration.findUnique({ where: { userId_installId: { userId: context.userId, installId: report.installId } } });
  const base = {
    platform: platformOf(report.platform),
    appVersion: report.appVersion,
    appBuild: report.appBuild ?? null,
    osVersion: report.osVersion ?? null,
    deviceClass: report.deviceClass ?? existing?.deviceClass ?? null,
    reportedRisk: report.reportedRisk ?? [],
    appLockEnabled: report.appLockEnabled ?? null,
  };
  const compliance = evaluateDeviceCompliance({ platform: base.platform, status: existing?.status ?? "ACTIVE", appVersion: base.appVersion, appBuild: base.appBuild, osVersion: base.osVersion, reportedRisk: base.reportedRisk }, policy);

  let row = existing;
  let created = !existing;
  const unchanged = existing && sameReport(existing, report, policy.policyVersion, context.sessionId) && now - existing.lastSeenAt.getTime() < DEVICE_TOUCH_INTERVAL_MS && existing.complianceAction === compliance.action;
  if (!unchanged) {
    const data = {
      ...base,
      // A name the person or an administrator chose is kept; the OS name only fills a gap.
      deviceName: existing?.deviceName ?? report.deviceName ?? null,
      sessionId: context.sessionId || null,
      lastSeenAt: new Date(now),
      lastSecurityCheckAt: new Date(now),
      complianceState: compliance.state,
      complianceAction: compliance.action,
      complianceReasons: compliance.reasons,
      trustState: compliance.trustState,
      policyVersion: policy.policyVersion,
    };
    if (existing) row = await prisma.deviceRegistration.update({ where: { id: existing.id }, data });
    else {
      try {
        row = await prisma.deviceRegistration.create({ data: { ...data, userId: context.userId, installId: report.installId, enabled: false } });
      } catch {
        // Two first calls at once (sign-in and resume): the other one won; refresh that row.
        row = await prisma.deviceRegistration.update({ where: { userId_installId: { userId: context.userId, installId: report.installId } }, data });
        created = false;
      }
    }
  }
  if (!row) throw new AccessError("INTERNAL_ERROR");

  if (created) {
    await recordAuthEvent({ type: "DEVICE_REGISTERED", userId: context.userId, companyId: context.companyId, sessionId: context.sessionId, metadata: { deviceId: row.id, platform: row.platform } });
  }
  if (row.status !== "ACTIVE") {
    // A revoked or blocked install proved itself by calling in: its session ends here (MOB-11 §18, §22).
    await revokeSessions(prisma, { sessionId: context.sessionId, userId: context.userId });
  } else if (context.sessionId) {
    await prisma.session.updateMany({ where: { id: context.sessionId, userId: context.userId }, data: { deviceId: row.id, lastSeenAt: new Date(now) } });
  }
  if (compliance.action === "REQUIRE_UPDATE" && existing?.complianceAction !== "REQUIRE_UPDATE") {
    await recordAuthEvent({ type: "SECURITY_UPDATE_REQUIRED", userId: context.userId, companyId: context.companyId, sessionId: context.sessionId, metadata: { deviceId: row.id, reasons: compliance.reasons, appVersion: report.appVersion } });
  }

  return stateOf(row, compliance, policy, now);
}

function stateOf(
  row: { id: string; userId: string; status: "ACTIVE" | "REVOKED" | "BLOCKED"; deviceName: string | null; dataRemovalMode: "NONE" | "CACHE_ONLY" | "FULL"; dataRemovalRequestedAt: Date | null; dataRemovalConfirmedAt: Date | null },
  compliance: ComplianceResult,
  policy: EffectiveMobilePolicy,
  now: number,
): DeviceSecurityState {
  const removing = row.dataRemovalMode !== "NONE" && row.dataRemovalRequestedAt && !row.dataRemovalConfirmedAt;
  return {
    device: { id: row.id, userId: row.userId, status: row.status, name: row.deviceName },
    compliance: { state: compliance.state, action: compliance.action, reasons: compliance.reasons },
    policy,
    serverTime: new Date(now).toISOString(),
    dataRemoval: removing && row.dataRemovalRequestedAt ? { mode: row.dataRemovalMode as "CACHE_ONLY" | "FULL", requestedAt: row.dataRemovalRequestedAt.toISOString() } : null,
  };
}

/* -------------------------------------------------------------------------- */
/* What a person and an administrator see                                      */
/* -------------------------------------------------------------------------- */

export type DeviceDisplayStatus = "ACTIVE" | "STALE" | "REVOKED" | "BLOCKED";

export type DeviceDTO = {
  id: string;
  userId: string;
  name: string;
  platform: "IOS" | "ANDROID";
  deviceClass: string | null;
  osVersion: string | null;
  appVersion: string;
  appBuild: string | null;
  status: DeviceDisplayStatus;
  complianceState: string;
  complianceReasons: string[];
  trustState: string;
  managedState: string;
  appLockEnabled: boolean | null;
  pushEnabled: boolean;
  activeSessions: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lostReportedAt: string | null;
  revokedAt: string | null;
  dataRemoval: { mode: string; requestedAt: string | null; confirmedAt: string | null } | null;
};

const PLATFORM_NAME = { IOS: "iPhone", ANDROID: "Android phone" } as const;

export const DEVICE_LIST_SELECT = {
  id: true,
  userId: true,
  platform: true,
  deviceName: true,
  deviceClass: true,
  osVersion: true,
  appVersion: true,
  appBuild: true,
  status: true,
  complianceState: true,
  complianceReasons: true,
  trustState: true,
  managedState: true,
  appLockEnabled: true,
  pushToken: true,
  enabled: true,
  createdAt: true,
  lastSeenAt: true,
  lostReportedAt: true,
  revokedAt: true,
  dataRemovalMode: true,
  dataRemovalRequestedAt: true,
  dataRemovalConfirmedAt: true,
  sessions: { select: { id: true, expiresAt: true } },
} satisfies Prisma.DeviceRegistrationSelect;

export type DeviceRow = Prisma.DeviceRegistrationGetPayload<{ select: typeof DEVICE_LIST_SELECT }>;

export function toDeviceDTO(row: DeviceRow, now: number = Date.now()): DeviceDTO {
  const stale = row.status === "ACTIVE" && now - row.lastSeenAt.getTime() > DEVICE_STALE_AFTER_MS;
  const fallback = row.deviceClass === "TABLET" ? (row.platform === "IOS" ? "iPad" : "Android tablet") : PLATFORM_NAME[row.platform];
  return {
    id: row.id,
    userId: row.userId,
    name: row.deviceName ?? fallback,
    platform: row.platform,
    deviceClass: row.deviceClass,
    osVersion: row.osVersion,
    appVersion: row.appVersion,
    appBuild: row.appBuild,
    status: stale ? "STALE" : row.status,
    complianceState: row.complianceState,
    complianceReasons: row.complianceReasons,
    trustState: row.trustState,
    managedState: row.managedState,
    appLockEnabled: row.appLockEnabled,
    pushEnabled: row.enabled && Boolean(row.pushToken),
    activeSessions: row.sessions.filter((session) => session.expiresAt.getTime() > now).length,
    firstSeenAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lostReportedAt: row.lostReportedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    dataRemoval: row.dataRemovalMode === "NONE" ? null : { mode: row.dataRemovalMode, requestedAt: row.dataRemovalRequestedAt?.toISOString() ?? null, confirmedAt: row.dataRemovalConfirmedAt?.toISOString() ?? null },
  };
}

/** The signed-in person's own devices, newest activity first (MOB-11 §15). */
export async function listOwnDevices(context: UserContext): Promise<Array<DeviceDTO & { current: boolean }>> {
  const currentDeviceId = context.sessionId ? (await prisma.session.findUnique({ where: { id: context.sessionId }, select: { deviceId: true } }))?.deviceId : null;
  const rows = await prisma.deviceRegistration.findMany({ where: { userId: context.userId }, orderBy: { lastSeenAt: "desc" }, take: 50, select: DEVICE_LIST_SELECT });
  const now = Date.now();
  return rows.map((row) => ({ ...toDeviceDTO(row, now), current: row.id === currentDeviceId }));
}

/** A label the person chose. Never identity, never used for security (MOB-11 §13). */
export async function renameOwnDevice(context: UserContext, deviceId: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new AccessError("VALIDATION_ERROR", "Enter a name for this device.");
  const { count } = await prisma.deviceRegistration.updateMany({ where: { id: deviceId, userId: context.userId }, data: { deviceName: clean } });
  if (count === 0) throw new AccessError("NOT_FOUND", "That device does not exist.");
}

/* -------------------------------------------------------------------------- */
/* Ending access                                                               */
/* -------------------------------------------------------------------------- */

export type DeviceRevocation = "REVOKE" | "LOST" | "BLOCK";

/**
 * Takes a device's access away (MOB-11 §18, §21, §29). In one transaction with
 * whatever audit the caller writes:
 *
 * - the device is marked REVOKED (or BLOCKED), with who, when and why;
 * - every session that signed in from it is deleted, so its next request is
 *   refused, and its push token is removed;
 * - NESTO Data Removal is queued for when the app next calls in — CACHE_ONLY
 *   for an ordinary revoke (unsynced work stays sealed and cannot be sent),
 *   FULL for lost or blocked (the local database and its key are destroyed).
 *
 * This is the removal of NESTO's own data and access, not a wipe of the phone:
 * a device that never calls in again keeps whatever it holds, which is why
 * offline authorization expires (MOB-11 §19, §126).
 *
 * The caller has authorised the action; this only does it.
 */
export async function revokeDevice(
  tx: Prisma.TransactionClient,
  input: { deviceId: string; actorUserId: string; actorCompanyId: string | null; kind: DeviceRevocation; reason?: string | null },
): Promise<{ userId: string; sessionsEnded: number; alreadyRevoked: boolean }> {
  const device = await tx.deviceRegistration.findUnique({ where: { id: input.deviceId }, select: { id: true, userId: true, status: true } });
  if (!device) throw new AccessError("NOT_FOUND", "That device does not exist.");
  const now = new Date();
  const status = input.kind === "BLOCK" ? ("BLOCKED" as const) : ("REVOKED" as const);
  const already = device.status === status;
  await tx.deviceRegistration.update({
    where: { id: device.id },
    data: {
      status,
      revokedAt: now,
      revokedById: input.actorUserId,
      revokeReason: input.reason?.trim().slice(0, 200) || null,
      ...(input.kind === "LOST" ? { lostReportedAt: now } : {}),
      complianceState: "BLOCKED",
      complianceAction: "BLOCK",
      complianceReasons: [input.kind === "BLOCK" ? "DEVICE_BLOCKED" : "DEVICE_REVOKED"],
      pushToken: null,
      enabled: false,
      dataRemovalMode: input.kind === "REVOKE" ? "CACHE_ONLY" : "FULL",
      dataRemovalRequestedAt: now,
      dataRemovalConfirmedAt: null,
    },
  });
  const sessionsEnded = await revokeSessions(tx, { deviceId: device.id });
  return { userId: device.userId, sessionsEnded, alreadyRevoked: already };
}

/** An administrator (or the person who revoked it) lets a device sign in again. The removal it asked for is cancelled. */
export async function restoreDevice(tx: Prisma.TransactionClient, deviceId: string): Promise<{ userId: string }> {
  const device = await tx.deviceRegistration.findUnique({ where: { id: deviceId }, select: { userId: true, status: true } });
  if (!device) throw new AccessError("NOT_FOUND", "That device does not exist.");
  await tx.deviceRegistration.update({
    where: { id: deviceId },
    data: { status: "ACTIVE", revokedAt: null, revokedById: null, revokeReason: null, lostReportedAt: null, complianceState: "UNKNOWN", complianceAction: "ALLOW", complianceReasons: [], dataRemovalMode: "NONE", dataRemovalRequestedAt: null, dataRemovalConfirmedAt: null },
  });
  return { userId: device.userId };
}

/** Signs a device out without revoking it: its sessions end, it may sign in again (MOB-11 §16, §17, §29). */
export async function signOutDevice(tx: Prisma.TransactionClient, deviceId: string): Promise<number> {
  return revokeSessions(tx, { deviceId });
}

/* -------------------------------------------------------------------------- */
/* A device that is signed out                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What an app that no longer has a session can still ask (MOB-11 §20, §126):
 * "was my access revoked, and am I to remove NESTO's data?" Unauthenticated by
 * necessity — there is no session to authenticate with — so it answers only for
 * the pairs the caller already holds (install id + user id, neither guessable),
 * returns nothing but a status and a removal instruction, and is rate limited
 * by the route.
 */
export async function probeDeviceState(installId: string, userIds: readonly string[]): Promise<Array<{ userId: string; status: "ACTIVE" | "REVOKED" | "BLOCKED"; dataRemoval: { mode: "CACHE_ONLY" | "FULL"; reason: "DEVICE" | "ACCOUNT" } | null }>> {
  if (!INSTALL_ID.test(installId) || userIds.length === 0) return [];
  const rows = await prisma.deviceRegistration.findMany({
    where: { installId, userId: { in: userIds.slice(0, 10) } },
    select: {
      userId: true,
      status: true,
      dataRemovalMode: true,
      dataRemovalRequestedAt: true,
      dataRemovalConfirmedAt: true,
      user: { select: { status: true, platformAccess: { select: { status: true } }, memberships: { where: { status: "ACTIVE", company: { status: "ACTIVE" } }, select: { id: true }, take: 1 } } },
    },
  });
  return rows.map((row) => {
    // An account that is disabled, or has no active workspace left, has no business holding NESTO data (MOB-11 §122):
    // a terminated person's phone is told the same thing a revoked one is, the next time it calls in. One workspace of
    // several going away is not this — that is the project-level 403 the sync already handles (§123, §160).
    const accountGone = row.user.status !== "ACTIVE" || (row.user.memberships.length === 0 && row.user.platformAccess?.status !== "ACTIVE");
    const requested = row.dataRemovalMode !== "NONE" && row.dataRemovalRequestedAt && !row.dataRemovalConfirmedAt;
    return {
      userId: row.userId,
      status: row.status,
      dataRemoval: requested ? { mode: row.dataRemovalMode as "CACHE_ONLY" | "FULL", reason: "DEVICE" as const } : accountGone ? { mode: "CACHE_ONLY" as const, reason: "ACCOUNT" as const } : null,
    };
  });
}

/**
 * The app reports that it did the removal. Informational — it is the device
 * speaking, not proof — and labelled that way wherever it is shown.
 */
export async function confirmDataRemoval(installId: string, userId: string): Promise<boolean> {
  if (!INSTALL_ID.test(installId)) return false;
  const row = await prisma.deviceRegistration.findUnique({ where: { userId_installId: { userId, installId } }, select: { id: true, dataRemovalRequestedAt: true, dataRemovalConfirmedAt: true } });
  if (!row?.dataRemovalRequestedAt || row.dataRemovalConfirmedAt) return false;
  await prisma.deviceRegistration.update({ where: { id: row.id }, data: { dataRemovalConfirmedAt: new Date() } });
  await recordAuthEvent({ type: "DEVICE_DATA_REMOVAL_CONFIRMED", userId, metadata: { deviceId: row.id } });
  return true;
}

/** The device row a sign-in from this install binds to, or null for a browser or a first sign-in (MOB-11 §11). */
export async function findDeviceForSignIn(userId: string, installId: string | null): Promise<{ id: string; status: "ACTIVE" | "REVOKED" | "BLOCKED" } | null> {
  if (!installId || !INSTALL_ID.test(installId)) return null;
  return prisma.deviceRegistration.findUnique({ where: { userId_installId: { userId, installId } }, select: { id: true, status: true } });
}

/* -------------------------------------------------------------------------- */
/* Policy changed                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Re-evaluates stored compliance for these people's devices after a policy
 * change, so a raised minimum version is enforced on the next request rather
 * than whenever each device next calls in (MOB-11 §80, §82). Revoked and
 * blocked devices are left alone.
 */
export async function recomputeDeviceCompliance(userIds: readonly string[]): Promise<number> {
  let changed = 0;
  for (const userId of userIds) {
    const [policy, devices] = await Promise.all([
      effectivePolicyForUser(userId),
      prisma.deviceRegistration.findMany({ where: { userId, status: "ACTIVE" }, select: { id: true, platform: true, status: true, appVersion: true, appBuild: true, osVersion: true, reportedRisk: true, complianceAction: true } }),
    ]);
    for (const device of devices) {
      const result = evaluateDeviceCompliance({ platform: device.platform, status: device.status, appVersion: device.appVersion, appBuild: device.appBuild, osVersion: device.osVersion, reportedRisk: device.reportedRisk }, policy);
      await prisma.deviceRegistration.update({
        where: { id: device.id },
        data: { complianceState: result.state, complianceAction: result.action, complianceReasons: result.reasons, trustState: result.trustState, policyVersion: policy.policyVersion, lastSecurityCheckAt: new Date() },
      });
      if (result.action !== device.complianceAction) changed += 1;
    }
  }
  return changed;
}
