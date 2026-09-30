import type { AuthEventType, Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { recordAuthEvent } from "@/lib/auth/events";
import {
  DEVICE_LIST_SELECT,
  listOwnDevices,
  recomputeDeviceCompliance,
  restoreDevice,
  revokeDevice,
  signOutDevice,
  toDeviceDTO,
  type DeviceDTO,
  type DeviceRevocation,
} from "@/lib/auth/device.service";
import { assertRecentAuthentication } from "@/lib/auth/recent-auth";
import type { UserContext } from "@/lib/context/types";
import { hasGroupStanding } from "@/lib/context/build-context";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import {
  mobilePolicySettingsSchema,
  resolveMobilePolicy,
  type EffectiveMobilePolicy,
  type MobilePolicySettings,
  type PolicyLevel,
} from "@/lib/core/security/mobile-policy.schema";
import { effectivePolicyForCompany, environmentPolicyLevel, loadPolicyLevels, readPolicyLevel, writePolicyLevel, type PolicyTarget } from "@/lib/core/security/mobile-policy.service";
import { prisma } from "@/lib/database/prisma";

/**
 * Mobile security administration (MOB-11 §23-§30, §73-§82, §113, §140-§141).
 *
 * A security surface, not a user list: it shows devices, compliance, sessions,
 * policy and security events — technical metadata about access — and never a
 * business record. Every function resolves its scope from the signed-in
 * person's own contexts (their company, or every company of the group they may
 * enter) and every permission is its own grant: reading devices does not allow
 * revoking one, revoking does not allow editing policy (§183). Platform Admin
 * has its own functions in `lib/modules/platform`; nothing here reaches across
 * groups.
 */

export type SecurityScope = {
  /** The contexts the person holds this permission in: their company, or each company of the group in the Group workspace. */
  contexts: UserContext[];
  companyIds: string[];
  parentGroupId: string;
  groupWorkspace: boolean;
};

export async function securityScope(context: UserContext, permission: Permission): Promise<SecurityScope> {
  const candidates = context.workspace.scopeType === "GROUP" ? await resolveGroupContexts(context) : [context];
  const contexts = candidates.filter((candidate) => can(candidate, permission));
  if (contexts.length === 0) throw new AccessError("FORBIDDEN");
  return { contexts, companyIds: contexts.map((c) => c.companyId), parentGroupId: context.parentGroupId, groupWorkspace: context.workspace.scopeType === "GROUP" };
}

/** Whether the person may also edit the parent group's own level (not a standalone tenant; needs group standing). */
export async function canManageGroupPolicy(context: UserContext): Promise<boolean> {
  if (context.parentGroup.standalone || !can(context, "security.policy.manage")) return false;
  const contexts = context.workspace.scopeType === "GROUP" ? await resolveGroupContexts(context) : [context];
  return hasGroupStanding(contexts);
}

/* -------------------------------------------------------------------------- */
/* A person's own security                                                     */
/* -------------------------------------------------------------------------- */

export type OwnSecurityEvent = { id: string; type: AuthEventType; at: string; detail: string | null };

const PERSONAL_EVENTS: AuthEventType[] = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "SESSION_REVOKED",
  "SESSIONS_REVOKED",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET_SUCCESS",
  "DEVICE_REGISTERED",
  "DEVICE_REVOKED",
  "DEVICE_LOST_REPORTED",
  "DEVICE_BLOCKED",
  "DEVICE_RESTORED",
  "DEVICE_DATA_REMOVAL_CONFIRMED",
  "BIOMETRIC_ENABLED",
  "BIOMETRIC_DISABLED",
  "SECURITY_UPDATE_REQUIRED",
  "SENSITIVE_REAUTH",
];

/** The person's own recent security history (MOB-11 §113). No addresses, no user agents. */
export async function listOwnSecurityEvents(context: UserContext, limit = 20): Promise<OwnSecurityEvent[]> {
  const rows = await prisma.authEvent.findMany({ where: { userId: context.userId, type: { in: PERSONAL_EVENTS } }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, type: true, createdAt: true, metadata: true } });
  return rows.map((row) => ({ id: row.id, type: row.type, at: row.createdAt.toISOString(), detail: typeof (row.metadata as { platform?: unknown } | null)?.platform === "string" ? String((row.metadata as { platform: string }).platform) : null }));
}

export async function ownDevices(context: UserContext): Promise<Array<DeviceDTO & { current: boolean }>> {
  return listOwnDevices(context);
}

/**
 * The person ends access for one of their own devices (MOB-11 §16-§18, §21).
 * `SIGN_OUT` ends its sessions and lets it sign in again; `REVOKE` and `LOST`
 * also remove its access until an administrator (or the person, from another
 * device) restores it, and queue NESTO Data Removal.
 */
export async function actOnOwnDevice(context: UserContext, deviceId: string, action: "SIGN_OUT" | DeviceRevocation): Promise<{ sessionsEnded: number; current: boolean }> {
  await assertRecentAuthentication(context);
  const device = await prisma.deviceRegistration.findFirst({ where: { id: deviceId, userId: context.userId }, select: { id: true, status: true, sessions: { select: { id: true } } } });
  if (!device) throw new AccessError("NOT_FOUND", "That device does not exist.");
  const current = device.sessions.some((session) => session.id === context.sessionId);
  const result = await endDeviceAccess(context, device.id, context.userId, action);
  return { sessionsEnded: result.sessionsEnded, current };
}

/** The person (who revoked it themselves) lets one of their devices sign in again. */
export async function restoreOwnDevice(context: UserContext, deviceId: string): Promise<void> {
  await assertRecentAuthentication(context);
  const device = await prisma.deviceRegistration.findFirst({ where: { id: deviceId, userId: context.userId }, select: { id: true, status: true, revokedById: true, lostReportedAt: true } });
  if (!device) throw new AccessError("NOT_FOUND", "That device does not exist.");
  // A block or a revoke an administrator made is theirs to lift (MOB-11 §29); a lost device stays revoked until they say so.
  if (device.status !== "REVOKED" || device.revokedById !== context.userId) throw new AccessError("FORBIDDEN");
  await prisma.$transaction(async (tx) => {
    await restoreDevice(tx, device.id);
    await recordUserAction(context, { actionKey: AuditAction.MOBILE_DEVICE_RESTORED, entity: { type: "Device", id: device.id, label: "Device" }, before: { deviceId: device.id, userId: context.userId, status: device.status }, after: { deviceId: device.id, userId: context.userId, status: "ACTIVE" } }, { tx });
  });
  await recordAuthEvent({ type: "DEVICE_RESTORED", userId: context.userId, companyId: context.companyId, sessionId: context.sessionId, metadata: { deviceId: device.id } });
}

/* -------------------------------------------------------------------------- */
/* Administrators                                                              */
/* -------------------------------------------------------------------------- */

export type AdminDeviceDTO = DeviceDTO & { user: { id: string; fullName: string; username: string }; companies: string[] };

export type DeviceFilters = {
  q?: string;
  status?: "ACTIVE" | "STALE" | "REVOKED" | "BLOCKED";
  platform?: "IOS" | "ANDROID";
  companyId?: string;
  compliance?: "COMPLIANT" | "WARNING" | "NON_COMPLIANT" | "BLOCKED" | "UNKNOWN";
  appVersion?: string;
};

const ADMIN_SELECT = {
  ...DEVICE_LIST_SELECT,
  user: { select: { id: true, firstName: true, lastName: true, username: true, memberships: { select: { companyId: true, company: { select: { name: true } } } } } },
} satisfies Prisma.DeviceRegistrationSelect;

type AdminRow = Prisma.DeviceRegistrationGetPayload<{ select: typeof ADMIN_SELECT }>;

function toAdminDTO(row: AdminRow, companyIds: readonly string[], now: number): AdminDeviceDTO {
  return {
    ...toDeviceDTO(row, now),
    user: { id: row.user.id, fullName: `${row.user.firstName} ${row.user.lastName}`.trim(), username: row.user.username },
    // Only the companies the administrator may see, never the person's other employers.
    companies: row.user.memberships.filter((m) => companyIds.includes(m.companyId)).map((m) => m.company.name),
  };
}

function deviceWhere(scope: SecurityScope, filters: DeviceFilters): Prisma.DeviceRegistrationWhereInput {
  const companyIds = filters.companyId ? scope.companyIds.filter((id) => id === filters.companyId) : scope.companyIds;
  const stale = new Date(Date.now() - 60 * 24 * 3_600_000);
  return {
    user: { memberships: { some: { companyId: { in: companyIds } } }, ...(filters.q ? { OR: [{ firstName: { contains: filters.q, mode: "insensitive" } }, { lastName: { contains: filters.q, mode: "insensitive" } }, { username: { contains: filters.q, mode: "insensitive" } }] } : {}) },
    ...(filters.platform ? { platform: filters.platform } : {}),
    ...(filters.compliance ? { complianceState: filters.compliance } : {}),
    ...(filters.appVersion ? { appVersion: filters.appVersion } : {}),
    ...(filters.status === "STALE" ? { status: "ACTIVE", lastSeenAt: { lt: stale } } : filters.status === "ACTIVE" ? { status: "ACTIVE", lastSeenAt: { gte: stale } } : filters.status ? { status: filters.status } : {}),
  };
}

export async function listDevices(context: UserContext, filters: DeviceFilters = {}, page = { take: 50, skip: 0 }): Promise<{ rows: AdminDeviceDTO[]; total: number }> {
  const scope = await securityScope(context, "security.devices.read");
  const where = deviceWhere(scope, filters);
  const [rows, total] = await Promise.all([
    prisma.deviceRegistration.findMany({ where, orderBy: { lastSeenAt: "desc" }, take: Math.min(page.take, 100), skip: page.skip, select: ADMIN_SELECT }),
    prisma.deviceRegistration.count({ where }),
  ]);
  const now = Date.now();
  return { rows: rows.map((row) => toAdminDTO(row, scope.companyIds, now)), total };
}

export async function getDevice(context: UserContext, deviceId: string): Promise<AdminDeviceDTO> {
  const scope = await securityScope(context, "security.devices.read");
  const row = await prisma.deviceRegistration.findFirst({ where: { id: deviceId, ...deviceWhere(scope, {}) }, select: ADMIN_SELECT });
  // Out of scope answers exactly like missing (PRD #7 §60).
  if (!row) throw new AccessError("NOT_FOUND", "That device does not exist.");
  return toAdminDTO(row, scope.companyIds, Date.now());
}

export type SecurityDashboard = { active: number; updateRequired: number; nonCompliant: number; revoked: number; stale: number; total: number };

/** Aggregate technical metadata only (MOB-11 §140, §141, §186). */
export async function securityDashboard(context: UserContext): Promise<SecurityDashboard> {
  const scope = await securityScope(context, "security.devices.read");
  const base = deviceWhere(scope, {});
  const stale = new Date(Date.now() - 60 * 24 * 3_600_000);
  const [active, updateRequired, nonCompliant, revoked, staleCount, total] = await Promise.all([
    prisma.deviceRegistration.count({ where: { ...base, status: "ACTIVE", lastSeenAt: { gte: stale } } }),
    prisma.deviceRegistration.count({ where: { ...base, status: "ACTIVE", complianceAction: "REQUIRE_UPDATE" } }),
    prisma.deviceRegistration.count({ where: { ...base, status: "ACTIVE", complianceState: { in: ["NON_COMPLIANT", "BLOCKED"] } } }),
    prisma.deviceRegistration.count({ where: { ...base, status: { in: ["REVOKED", "BLOCKED"] } } }),
    prisma.deviceRegistration.count({ where: { ...base, status: "ACTIVE", lastSeenAt: { lt: stale } } }),
    prisma.deviceRegistration.count({ where: base }),
  ]);
  return { active, updateRequired, nonCompliant, revoked, stale: staleCount, total };
}

const REVOKE_AUDIT: Record<DeviceRevocation, (typeof AuditAction)[keyof typeof AuditAction]> = {
  REVOKE: AuditAction.MOBILE_DEVICE_REVOKED,
  LOST: AuditAction.MOBILE_DEVICE_LOST,
  BLOCK: AuditAction.MOBILE_DEVICE_BLOCKED,
};
const REVOKE_EVENT: Record<DeviceRevocation, AuthEventType> = { REVOKE: "DEVICE_REVOKED", LOST: "DEVICE_LOST_REPORTED", BLOCK: "DEVICE_BLOCKED" };

/** The one place a device's access ends — for the person, for an administrator — with its audit row in the same transaction. */
async function endDeviceAccess(context: UserContext, deviceId: string, ownerId: string, action: "SIGN_OUT" | DeviceRevocation, reason?: string | null): Promise<{ sessionsEnded: number }> {
  const result = await prisma.$transaction(async (tx) => {
    if (action === "SIGN_OUT") {
      const sessionsEnded = await signOutDevice(tx, deviceId);
      await recordUserAction(context, { actionKey: AuditAction.MOBILE_DEVICE_SESSIONS_ENDED, entity: { type: "Device", id: deviceId, label: "Device" }, after: { deviceId, userId: ownerId, sessionsEnded } }, { tx });
      return { sessionsEnded };
    }
    const done = await revokeDevice(tx, { deviceId, actorUserId: context.userId, actorCompanyId: context.companyId, kind: action, reason });
    await recordUserAction(
      context,
      {
        actionKey: REVOKE_AUDIT[action],
        entity: { type: "Device", id: deviceId, label: "Device" },
        before: { deviceId, userId: ownerId },
        after: { deviceId, userId: ownerId, status: action === "BLOCK" ? "BLOCKED" : "REVOKED", sessionsEnded: done.sessionsEnded, dataRemoval: action === "REVOKE" ? "CACHE_ONLY" : "FULL" },
      },
      { tx },
    );
    return { sessionsEnded: done.sessionsEnded };
  });
  await recordAuthEvent({
    type: action === "SIGN_OUT" ? "SESSIONS_REVOKED" : REVOKE_EVENT[action],
    userId: ownerId,
    companyId: context.companyId,
    sessionId: context.sessionId,
    metadata: { deviceId, actorUserId: context.userId, ...(action === "SIGN_OUT" ? { scope: "device" } : {}), sessionsEnded: result.sessionsEnded },
  });
  return result;
}

/**
 * An administrator acts on a device in their scope (MOB-11 §29, §30, §184).
 * `SIGN_OUT` needs `security.sessions.revoke`; revoke, lost and block need
 * `security.devices.revoke`; `RESTORE` needs the same. All need a recent
 * sign-in, and out-of-scope devices answer 404.
 */
export async function adminActOnDevice(context: UserContext, deviceId: string, input: { action: "SIGN_OUT" | "REAUTH" | "RESTORE" | DeviceRevocation; reason?: string | null }): Promise<{ sessionsEnded: number }> {
  const permission: Permission = input.action === "SIGN_OUT" || input.action === "REAUTH" ? "security.sessions.revoke" : "security.devices.revoke";
  const scope = await securityScope(context, permission);
  await assertRecentAuthentication(context);
  const device = await prisma.deviceRegistration.findFirst({ where: { id: deviceId, ...deviceWhere(scope, {}) }, select: { id: true, userId: true, status: true } });
  if (!device) throw new AccessError("NOT_FOUND", "That device does not exist.");

  if (input.action === "RESTORE") {
    await prisma.$transaction(async (tx) => {
      await restoreDevice(tx, device.id);
      await recordUserAction(context, { actionKey: AuditAction.MOBILE_DEVICE_RESTORED, entity: { type: "Device", id: device.id, label: "Device" }, before: { deviceId: device.id, userId: device.userId, status: device.status }, after: { deviceId: device.id, userId: device.userId, status: "ACTIVE" } }, { tx });
    });
    await recordAuthEvent({ type: "DEVICE_RESTORED", userId: device.userId, companyId: context.companyId, sessionId: context.sessionId, metadata: { deviceId: device.id, actorUserId: context.userId } });
    return { sessionsEnded: 0 };
  }
  if (input.action === "REAUTH") {
    const result = await endDeviceAccess(context, device.id, device.userId, "SIGN_OUT");
    await recordAuthEvent({ type: "DEVICE_REAUTH_REQUIRED", userId: device.userId, companyId: context.companyId, sessionId: context.sessionId, metadata: { deviceId: device.id, actorUserId: context.userId } });
    return result;
  }
  return endDeviceAccess(context, device.id, device.userId, input.action, input.reason);
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

export type PolicyLevelView = {
  target: PolicyTarget;
  label: string;
  settings: MobilePolicySettings;
  version: number | null;
  editable: boolean;
  /** What a Group has decided for this level: its values are a floor a Company cannot go below. */
  locked?: boolean;
};

export type PolicyView = {
  platform: { settings: MobilePolicySettings; version: number | null };
  group: PolicyLevelView | null;
  companies: Array<PolicyLevelView & { effective: EffectiveMobilePolicy }>;
  /** The group has turned overrides off: Companies use the Group's policy as it is. */
  companyOverrideAllowed: boolean;
};

export async function getPolicyView(context: UserContext): Promise<PolicyView> {
  const scope = await securityScope(context, "security.policy.read");
  const [platformRow, groupRow, manageGroup] = await Promise.all([readPolicyLevel({ scope: "PLATFORM" }), readPolicyLevel({ scope: "PARENT_GROUP", id: scope.parentGroupId }), canManageGroupPolicy(context)]);
  const companyOverrideAllowed = groupRow?.settings.allowCompanyOverride !== false;
  const group = context.parentGroup.standalone
    ? null
    : { target: { scope: "PARENT_GROUP", id: scope.parentGroupId } as PolicyTarget, label: context.parentGroup.name, settings: groupRow?.settings ?? {}, version: groupRow?.version ?? null, editable: manageGroup };
  const managers = new Set(scope.contexts.filter((c) => can(c, "security.policy.manage")).map((c) => c.companyId));
  const companies = await Promise.all(
    scope.contexts.map(async (c) => {
      const [row, effective] = await Promise.all([readPolicyLevel({ scope: "COMPANY", id: c.companyId }), effectivePolicyForCompany(c.companyId)]);
      return { target: { scope: "COMPANY", id: c.companyId } as PolicyTarget, label: c.company.name, settings: row?.settings ?? {}, version: row?.version ?? null, editable: managers.has(c.companyId) && companyOverrideAllowed, effective: effective ?? resolveMobilePolicy([environmentPolicyLevel()]) };
    }),
  );
  return { platform: { settings: platformRow?.settings ?? {}, version: platformRow?.version ?? null }, group, companies, companyOverrideAllowed };
}

const SCALAR_KEYS = [
  "appLockRequired",
  "biometricRequired",
  "appLockTimeoutSeconds",
  "offlineAllowed",
  "offlineAuthorizationHours",
  "documentExportAllowed",
  "nativeShareAllowed",
  "externalOpenAllowed",
  "minimumAppVersion",
  "minimumSecureVersion",
  "recommendedAppVersion",
  "deviceRiskPolicy",
  "notificationPreviewPolicy",
  "sensitiveScreenProtection",
  "recentAuthMinutes",
] as const satisfies ReadonlyArray<keyof MobilePolicySettings>;

/**
 * Values a lower level set that a higher level overrides (MOB-11 §74, §168).
 * The merge already guarantees a Company cannot weaken a Group; this says so at
 * save time instead of accepting a setting that then silently does nothing.
 */
export function weakerThanParent(parentLevels: readonly PolicyLevel[], level: PolicyLevel): string[] {
  const merged = resolveMobilePolicy([...parentLevels, level]);
  const weaker: string[] = SCALAR_KEYS.filter((key) => level.settings[key] !== undefined && merged[key] !== level.settings[key]);
  for (const platform of ["ios", "android"] as const) {
    const value = level.settings.minimumOsVersion?.[platform];
    if (value && merged.minimumOsVersion[platform] !== value) weaker.push(`minimumOsVersion.${platform}`);
  }
  return weaker;
}

export type SavePolicyResult = { version: number; devicesUpdated: number };

/**
 * Saves one level of the policy (MOB-11 §74, §80, §185). Who may edit which
 * level: a Company's level by someone holding `security.policy.manage` there,
 * unless the Group has closed overrides; the Group's level by someone with
 * `security.policy.manage` and group standing. Platform has its own door.
 */
export async function savePolicy(context: UserContext, target: Exclude<PolicyTarget, { scope: "PLATFORM" }>, raw: unknown): Promise<SavePolicyResult> {
  const scope = await securityScope(context, "security.policy.manage");
  await assertRecentAuthentication(context);
  const parsed = mobilePolicySettingsSchema.safeParse(raw);
  if (!parsed.success) throw new AccessError("VALIDATION_ERROR", "Some of the supplied values are not valid.", Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? "form"), [issue.message]])));
  const settings = parsed.data;

  let parentLevels: PolicyLevel[];
  let companyIdsAffected: string[];
  if (target.scope === "PARENT_GROUP") {
    if (target.id !== scope.parentGroupId || !(await canManageGroupPolicy(context))) throw new AccessError("FORBIDDEN");
    parentLevels = [environmentPolicyLevel(), ...(await levelsOf({ scope: "PLATFORM" }))];
    companyIdsAffected = (await prisma.company.findMany({ where: { parentGroupId: target.id }, select: { id: true } })).map((c) => c.id);
  } else {
    // A company not in the person's own scope answers like one that does not exist.
    if (!scope.companyIds.includes(target.id)) throw new AccessError("NOT_FOUND", "That company does not exist.");
    const company = await prisma.company.findUnique({ where: { id: target.id }, select: { id: true, parentGroupId: true } });
    if (!company) throw new AccessError("NOT_FOUND", "That company does not exist.");
    const groupRow = await readPolicyLevel({ scope: "PARENT_GROUP", id: company.parentGroupId });
    if (groupRow?.settings.allowCompanyOverride === false) throw new AccessError("CONFLICT", "Your group manages this policy centrally.", { code: "GROUP_POLICY_LOCKED" });
    parentLevels = await loadParentLevels(company.parentGroupId);
    companyIdsAffected = [company.id];
  }

  const weaker = weakerThanParent(parentLevels, { scope: target.scope, id: target.id, parentGroupId: target.scope === "COMPANY" ? scope.parentGroupId : null, version: 0, settings });
  if (weaker.length) {
    const message = "A higher level already requires something stricter than this.";
    throw new AccessError("VALIDATION_ERROR", message, Object.fromEntries(weaker.map((key) => [key, [message]])));
  }

  const { version } = await prisma.$transaction(async (tx) => {
    const written = await writePolicyLevel(target, settings, context.userId);
    await recordUserAction(context, { actionKey: AuditAction.MOBILE_POLICY_CHANGED, entity: { type: "MobileSecurityPolicy", id: `${target.scope}:${target.id}`, label: target.scope === "PARENT_GROUP" ? context.parentGroup.name : "Company mobile policy" }, before: { scope: target.scope, scopeId: target.id, version: written.version - 1, settings: written.before ?? {} }, after: { scope: target.scope, scopeId: target.id, version: written.version, settings } }, { tx });
    return written;
  });
  await recordAuthEvent({ type: "POLICY_CHANGED", userId: context.userId, companyId: context.companyId, sessionId: context.sessionId, metadata: { scope: target.scope, scopeId: target.id, version } });

  // The new rules bite on the next request, not whenever each device next calls in (MOB-11 §80, §82).
  const members = await prisma.companyMember.findMany({ where: { companyId: { in: companyIdsAffected }, status: "ACTIVE" }, select: { userId: true }, distinct: ["userId"] });
  const devicesUpdated = await recomputeDeviceCompliance(members.map((m) => m.userId));
  return { version, devicesUpdated };
}

async function levelsOf(target: PolicyTarget): Promise<PolicyLevel[]> {
  const row = await readPolicyLevel(target);
  return row ? [{ scope: target.scope, id: target.scope === "PLATFORM" ? null : target.id, version: row.version, settings: row.settings }] : [];
}

/** Platform and Group levels above a Company. */
async function loadParentLevels(parentGroupId: string): Promise<PolicyLevel[]> {
  const levels = await loadPolicyLevels([]);
  const group = await levelsOf({ scope: "PARENT_GROUP", id: parentGroupId });
  return [...levels, ...group];
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export type SecurityEventDTO = { id: string; type: AuthEventType; at: string; user: { id: string; fullName: string } | null; deviceId: string | null; scope: string | null; result: "SUCCESS" | "FAILURE" | "INFO" };

const ADMIN_EVENTS: AuthEventType[] = [
  "DEVICE_REGISTERED",
  "DEVICE_REVOKED",
  "DEVICE_BLOCKED",
  "DEVICE_RESTORED",
  "DEVICE_LOST_REPORTED",
  "DEVICE_DATA_REMOVAL_CONFIRMED",
  "DEVICE_REAUTH_REQUIRED",
  "SESSION_REVOKED",
  "SESSIONS_REVOKED",
  "LOGIN_FAILED",
  "LOGIN_RATE_LIMITED",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET_SUCCESS",
  "BIOMETRIC_ENABLED",
  "BIOMETRIC_DISABLED",
  "POLICY_CHANGED",
  "SECURITY_UPDATE_REQUIRED",
  "SENSITIVE_REAUTH",
];

/**
 * Security events for the people in the administrator's scope (MOB-11 §113).
 * No secrets, no addresses: who, what, when, and whether it worked. Events about
 * people outside the scope — and every platform-level event — are not here.
 */
export async function listSecurityEvents(context: UserContext, filters: { type?: AuthEventType; limit?: number } = {}): Promise<SecurityEventDTO[]> {
  const scope = await securityScope(context, "security.audit.read");
  const rows = await prisma.authEvent.findMany({
    where: {
      type: filters.type ? filters.type : { in: ADMIN_EVENTS },
      OR: [{ user: { memberships: { some: { companyId: { in: scope.companyIds } } } } }, { companyId: { in: scope.companyIds } }],
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 50, 200),
    select: { id: true, type: true, createdAt: true, metadata: true, user: { select: { id: true, firstName: true, lastName: true } } },
  });
  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as { deviceId?: unknown; scope?: unknown };
    return {
      id: row.id,
      type: row.type,
      at: row.createdAt.toISOString(),
      user: row.user ? { id: row.user.id, fullName: `${row.user.firstName} ${row.user.lastName}`.trim() } : null,
      deviceId: typeof meta.deviceId === "string" ? meta.deviceId : null,
      scope: typeof meta.scope === "string" ? meta.scope : null,
      result: row.type === "LOGIN_FAILED" || row.type === "LOGIN_RATE_LIMITED" ? "FAILURE" : row.type === "SECURITY_UPDATE_REQUIRED" ? "INFO" : "SUCCESS",
    };
  });
}
