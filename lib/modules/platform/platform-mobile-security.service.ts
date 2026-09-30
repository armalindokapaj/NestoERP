import type { Prisma } from "@prisma/client";

import type { PlatformPermission } from "@/config/platform";
import { AccessError } from "@/lib/access/guards";
import {
  DEVICE_LIST_SELECT,
  recomputeDeviceCompliance,
  restoreDevice,
  revokeDevice,
  toDeviceDTO,
  type DeviceDTO,
  type DeviceRevocation,
} from "@/lib/auth/device.service";
import { recordAuthEvent } from "@/lib/auth/events";
import { assertRecentAuthentication } from "@/lib/auth/recent-auth";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordGlobalPlatformAction } from "@/lib/core/audit/audit.service";
import { mobilePolicySettingsSchema, type MobilePolicySettings } from "@/lib/core/security/mobile-policy.schema";
import { readPolicyLevel, writePolicyLevel } from "@/lib/core/security/mobile-policy.service";
import { prisma } from "@/lib/database/prisma";

/**
 * Platform Admin's side of mobile security (MOB-11 §26, §184).
 *
 * The technical operator across tenants — not the customers' daily device
 * administrator. Every action is audited globally and needs a reason and a
 * recent sign-in, and the platform level of the policy is the only level edited
 * here; Group and Company levels belong to the customer's own administrators.
 */

function assertPlatform(context: PlatformContext, permission: PlatformPermission): void {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

export type PlatformDeviceDTO = DeviceDTO & { user: { id: string; fullName: string; username: string }; companies: string[] };

const SELECT = {
  ...DEVICE_LIST_SELECT,
  user: { select: { id: true, firstName: true, lastName: true, username: true, memberships: { select: { company: { select: { name: true } } } } } },
} satisfies Prisma.DeviceRegistrationSelect;

export async function listPlatformDevices(context: PlatformContext, filters: { status?: "ACTIVE" | "REVOKED" | "BLOCKED" } = {}): Promise<PlatformDeviceDTO[]> {
  assertPlatform(context, "platform.device.view");
  const rows = await prisma.deviceRegistration.findMany({ where: filters.status ? { status: filters.status } : {}, orderBy: { lastSeenAt: "desc" }, take: 200, select: SELECT });
  const now = Date.now();
  return rows.map((row) => ({
    ...toDeviceDTO(row, now),
    user: { id: row.user.id, fullName: `${row.user.firstName} ${row.user.lastName}`.trim(), username: row.user.username },
    companies: [...new Set(row.user.memberships.map((m) => m.company.name))],
  }));
}

export async function platformDeviceAction(context: PlatformContext, deviceId: string, input: { action: DeviceRevocation | "RESTORE"; reason: string }): Promise<{ sessionsEnded: number }> {
  assertPlatform(context, "platform.device.revoke");
  await assertRecentAuthentication(context);
  const device = await prisma.deviceRegistration.findUnique({ where: { id: deviceId }, select: { id: true, userId: true, status: true } });
  if (!device) throw new AccessError("NOT_FOUND", "That device does not exist.");
  if (input.action === "RESTORE") {
    await prisma.$transaction(async (tx) => {
      await restoreDevice(tx, device.id);
      await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_DEVICE_REVOKED, entity: { type: "Device", id: device.id, label: "Device" }, before: { deviceId: device.id, userId: device.userId, status: device.status }, after: { deviceId: device.id, userId: device.userId, status: "ACTIVE" }, reason: input.reason }, { tx });
    });
    await recordAuthEvent({ type: "DEVICE_RESTORED", userId: device.userId, sessionId: context.sessionId, metadata: { deviceId: device.id, actorUserId: context.userId } });
    return { sessionsEnded: 0 };
  }
  const kind: DeviceRevocation = input.action;
  const result = await prisma.$transaction(async (tx) => {
    const done = await revokeDevice(tx, { deviceId: device.id, actorUserId: context.userId, actorCompanyId: null, kind, reason: input.reason });
    await recordGlobalPlatformAction(
      context,
      { actionKey: AuditAction.PLATFORM_DEVICE_REVOKED, entity: { type: "Device", id: device.id, label: "Device" }, before: { deviceId: device.id, userId: device.userId, status: device.status }, after: { deviceId: device.id, userId: device.userId, status: kind === "BLOCK" ? "BLOCKED" : "REVOKED", sessionsEnded: done.sessionsEnded, dataRemoval: kind === "REVOKE" ? "CACHE_ONLY" : "FULL" }, reason: input.reason },
      { tx },
    );
    return done;
  });
  await recordAuthEvent({ type: kind === "BLOCK" ? "DEVICE_BLOCKED" : kind === "LOST" ? "DEVICE_LOST_REPORTED" : "DEVICE_REVOKED", userId: device.userId, sessionId: context.sessionId, metadata: { deviceId: device.id, actorUserId: context.userId, sessionsEnded: result.sessionsEnded } });
  return { sessionsEnded: result.sessionsEnded };
}

export async function getPlatformMobilePolicy(context: PlatformContext): Promise<{ settings: MobilePolicySettings; version: number | null }> {
  assertPlatform(context, "platform.security.view");
  const row = await readPolicyLevel({ scope: "PLATFORM" });
  return { settings: row?.settings ?? {}, version: row?.version ?? null };
}

/** The platform minimum every Group and Company builds on (MOB-11 §74). Audited globally, with a reason. */
export async function savePlatformMobilePolicy(context: PlatformContext, raw: unknown, reason: string): Promise<{ version: number; devicesUpdated: number }> {
  assertPlatform(context, "platform.mobile_policy.manage");
  await assertRecentAuthentication(context);
  const parsed = mobilePolicySettingsSchema.safeParse(raw);
  if (!parsed.success) throw new AccessError("VALIDATION_ERROR", "Some of the supplied values are not valid.", Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? "form"), [issue.message]])));
  // Closing Companies' overrides is a Group's own choice, not the platform's.
  const { allowCompanyOverride: _ignored, ...settings } = parsed.data;
  void _ignored;
  const { version } = await prisma.$transaction(async (tx) => {
    const written = await writePolicyLevel({ scope: "PLATFORM" }, settings, context.userId);
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.PLATFORM_MOBILE_POLICY_CHANGED, entity: { type: "MobileSecurityPolicy", id: "PLATFORM", label: "Platform mobile policy" }, before: { scope: "PLATFORM", version: written.version - 1, settings: written.before ?? {} }, after: { scope: "PLATFORM", version: written.version, settings }, reason }, { tx });
    return written;
  });
  await recordAuthEvent({ type: "POLICY_CHANGED", userId: context.userId, sessionId: context.sessionId, metadata: { scope: "PLATFORM", version } });
  // Everyone with a device: a raised minimum version has to bite on the next request (MOB-11 §80, §82).
  const users = await prisma.deviceRegistration.findMany({ where: { status: "ACTIVE" }, select: { userId: true }, distinct: ["userId"] });
  const devicesUpdated = await recomputeDeviceCompliance(users.map((u) => u.userId));
  return { version, devicesUpdated };
}
