import { Prisma, type AuditCategory } from "@prisma/client";

import { MODULE_KEYS, modules as moduleRegistry, type ModuleKey } from "@/config/modules";
import { isPermission, moduleForPermission, type Permission } from "@/config/permissions";
import { roleList } from "@/config/roles";
import { AccessError } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { buildMemberContext } from "@/lib/context/member-context";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { getMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";

function assertPlatform(context: PlatformContext, permission: Parameters<typeof canPlatform>[1]): void {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

export async function listPlatformCompanies(context: PlatformContext) {
  assertPlatform(context, "platform.company.view");
  const rows = await prisma.company.findMany({
    where: { parentGroup: { isTestFixture: false } },
    orderBy: [{ parentGroup: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
    select: { id: true, slug: true, name: true, legalName: true, registrationNumber: true, taxNumber: true, industry: true, country: true, address: true, email: true, phone: true, website: true, logoUrl: true, status: true, createdAt: true, parentGroup: { select: { id: true, name: true, kind: true } }, _count: { select: { memberships: true, projects: true, modules: { where: { enabled: true } } } } },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), users: row._count.memberships, projects: row._count.projects, modules: row._count.modules }));
}

export async function listPlatformProjects(context: PlatformContext) {
  assertPlatform(context, "platform.project.view");
  const rows = await prisma.project.findMany({
    where: { company: { parentGroup: { isTestFixture: false } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      archivedAt: true,
      createdAt: true,
      company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } },
      project3DEntitlement: { select: { status: true, viewerEnabled: true, planKey: true, activatedAt: true, expiresAt: true } },
      project3DConfig: { select: { activeReleaseId: true, _count: { select: { slots: true, releases: true } } } },
      _count: { select: { members: true } },
    },
  });
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    archivedAt: iso(row.archivedAt),
    members: row._count.members,
    threeD: row.project3DEntitlement || row.project3DConfig ? {
      entitlement: row.project3DEntitlement ? { ...row.project3DEntitlement, activatedAt: iso(row.project3DEntitlement.activatedAt), expiresAt: iso(row.project3DEntitlement.expiresAt) } : null,
      workspace: row.project3DConfig ? { activeReleaseId: row.project3DConfig.activeReleaseId, slots: row.project3DConfig._count.slots, releases: row.project3DConfig._count.releases } : null,
    } : null,
  }));
}

export async function listImplementations(context: PlatformContext) {
  assertPlatform(context, "platform.group.view");
  const rows = await prisma.parentGroup.findMany({
    where: { isTestFixture: false, kind: "GROUP" }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, name: true, slug: true, status: true, updatedAt: true, activatedAt: true, _count: { select: { companies: true, people: true, departments: true } } },
  });
  return rows.map((row) => ({
    ...row,
    implementationStatus: row.status === "ACTIVE" ? "COMPLETED" : row.status === "READY_FOR_VALIDATION" ? "READY_FOR_HANDOVER" : row.status === "SUSPENDED" ? "PAUSED" : row.status === "ARCHIVED" ? "COMPLETED" : "IN_PROGRESS",
    updatedAt: row.updatedAt.toISOString(), activatedAt: iso(row.activatedAt),
  }));
}

export async function listPlatformPeople(context: PlatformContext) {
  assertPlatform(context, "platform.people.view");
  const rows = await prisma.personProfile.findMany({
    where: { parentGroup: { isTestFixture: false } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    select: { id: true, firstName: true, lastName: true, preferredName: true, jobTitle: true, workEmail: true, workPhone: true, lifecycleStatus: true, createdAt: true, parentGroup: { select: { id: true, name: true } }, user: { select: { id: true, username: true, status: true, _count: { select: { memberships: true } } } } },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function listPlatformUsers(context: PlatformContext) {
  assertPlatform(context, "platform.user.view");
  const rows = await prisma.user.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    select: { id: true, username: true, firstName: true, lastName: true, email: true, status: true, lastLoginAt: true, createdAt: true, platformAccess: { select: { roleKey: true, status: true } }, personProfile: { select: { parentGroup: { select: { id: true, name: true } } } }, _count: { select: { memberships: true, sessions: true } } },
  });
  return rows.map((row) => ({ ...row, lastLoginAt: iso(row.lastLoginAt), createdAt: row.createdAt.toISOString() }));
}

export async function listPlatformMemberships(context: PlatformContext) {
  assertPlatform(context, "platform.membership.view");
  const rows = await prisma.companyMember.findMany({
    where: { company: { parentGroup: { isTestFixture: false } } }, orderBy: [{ user: { lastName: "asc" } }, { company: { name: "asc" } }, { id: "asc" }],
    select: { id: true, status: true, jobTitle: true, createdAt: true, user: { select: { id: true, username: true, firstName: true, lastName: true } }, company: { select: { id: true, name: true, parentGroup: { select: { id: true, name: true } } } }, role: { select: { key: true, name: true } }, department: { select: { name: true } } },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function listRolePermissionRegistry(context: PlatformContext) {
  assertPlatform(context, "platform.access.inspect");
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, description: true, _count: { select: { permissions: true, members: true } } } }),
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }], select: { id: true, key: true, module: true, action: true, description: true, _count: { select: { roles: true } } } }),
  ]);
  return { roles, permissions, catalogue: roleList };
}

export async function listPlatformGrants(context: PlatformContext) {
  assertPlatform(context, "platform.access.inspect");
  const rows = await prisma.accessGrant.findMany({
    where: { parentGroup: { isTestFixture: false } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, functionKey: true, scopeType: true, scopeId: true, accessLevel: true, startsAt: true, expiresAt: true, revokedAt: true, reason: true, createdAt: true, user: { select: { id: true, firstName: true, lastName: true, username: true } }, parentGroup: { select: { id: true, name: true } } },
  });
  return rows.map((row) => ({ ...row, startsAt: iso(row.startsAt), expiresAt: iso(row.expiresAt), revokedAt: iso(row.revokedAt), createdAt: row.createdAt.toISOString() }));
}

export async function listPlatformSessions(context: PlatformContext) {
  assertPlatform(context, "platform.session.view");
  const rows = await prisma.session.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 250,
    select: { id: true, userAgent: true, ipAddress: true, expiresAt: true, createdAt: true, updatedAt: true, user: { select: { id: true, username: true, firstName: true, lastName: true, status: true } }, company: { select: { id: true, name: true } } },
  });
  return rows.map((row) => ({ ...row, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), active: row.expiresAt > new Date() }));
}

export async function inspectAccess(context: PlatformContext, input: { userId: string; companyId: string; projectId?: string; permission: string }) {
  assertPlatform(context, "platform.access.inspect");
  if (!isPermission(input.permission)) throw new AccessError("VALIDATION_ERROR", "Choose a registered permission.");
  const permission = input.permission as Permission;
  const membership = await prisma.companyMember.findFirst({
    where: { userId: input.userId, companyId: input.companyId },
    select: { id: true, status: true, role: { select: { key: true, name: true } }, user: { select: { firstName: true, lastName: true, status: true } }, company: { select: { name: true, status: true, parentGroup: { select: { name: true, status: true } } } } },
  });
  const moduleKey = moduleForPermission(permission);
  const traces: Array<{ label: string; value: string; pass: boolean }> = [];
  if (!membership) {
    traces.push({ label: "Membership", value: "No membership in target company", pass: false });
    return { result: "DENY" as const, reason: "No company membership", permission, moduleKey, traces };
  }
  traces.push({ label: "Account", value: membership.user.status, pass: membership.user.status === "ACTIVE" });
  traces.push({ label: "Membership", value: membership.status, pass: membership.status === "ACTIVE" });
  traces.push({ label: "Company", value: membership.company.status, pass: membership.company.status === "ACTIVE" });
  traces.push({ label: "Parent group", value: membership.company.parentGroup.status, pass: ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"].includes(membership.company.parentGroup.status) });
  const memberContext = await buildMemberContext(input.companyId, membership.id);
  const moduleAccess = memberContext && moduleKey ? memberContext.moduleAccess[moduleKey as ModuleKey] : null;
  if (moduleKey) traces.push({ label: "Module", value: moduleAccess?.enabled ? `${moduleKey} enabled` : `${moduleKey} disabled`, pass: Boolean(moduleAccess?.enabled) });
  traces.push({ label: "Role", value: `${membership.role.name} (${membership.role.key})`, pass: true });
  traces.push({ label: "Permission", value: permission, pass: can(memberContext, permission) });
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, companyId: input.companyId }, select: { id: true, name: true, members: { where: { companyMemberId: membership.id, status: "ACTIVE" }, select: { id: true } } } });
    traces.push({ label: "Project", value: project ? `${project.name}${project.members.length ? " · assigned" : " · not assigned"}` : "Project not in target company", pass: Boolean(project) });
  }
  const denied = traces.find((trace) => !trace.pass);
  return { result: denied ? "DENY" as const : "ALLOW" as const, reason: denied?.value ?? "All contributing rules allow access", permission, moduleKey, traces };
}

export async function listPlatformModules(context: PlatformContext) {
  assertPlatform(context, "platform.module.view");
  const [rows, companies] = await Promise.all([
    prisma.module.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, description: true, route: true, status: true, companyModules: { select: { companyId: true, enabled: true, company: { select: { name: true, parentGroup: { select: { name: true } } } } } } } }),
    prisma.company.count({ where: { parentGroup: { isTestFixture: false } } }),
  ]);
  return rows.map((row) => ({ ...row, registry: moduleRegistry[row.key as ModuleKey] ?? null, enabledCompanies: row.companyModules.filter((item) => item.enabled).length, companies }));
}

export async function listFeatureFlags(context: PlatformContext) {
  assertPlatform(context, "platform.feature_flag.view");
  return prisma.featureFlag.findMany({ where: { archivedAt: null }, orderBy: { key: "asc" }, include: { overrides: { orderBy: [{ scopeType: "asc" }, { scopeId: "asc" }] } } });
}

export async function platformTemplates(context: PlatformContext) {
  assertPlatform(context, "platform.module.view");
  const [projectTypes, qualityTemplates, hseTemplates] = await Promise.all([
    prisma.projectType.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], take: 100, select: { id: true, name: true, isActive: true, company: { select: { name: true, parentGroup: { select: { name: true } } } } } }),
    prisma.inspectionTemplate.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 100, select: { id: true, name: true, status: true, version: true, company: { select: { name: true, parentGroup: { select: { name: true } } } } } }),
    prisma.hseInspectionTemplate.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 100, select: { id: true, name: true, status: true, version: true, company: { select: { name: true, parentGroup: { select: { name: true } } } } } }),
  ]);
  return { projectTypes, qualityTemplates, hseTemplates };
}

export async function resolveFeatureFlag(key: string, target: { userId?: string; companyId?: string; parentGroupId?: string }) {
  const flag = await prisma.featureFlag.findFirst({ where: { key, archivedAt: null }, include: { overrides: true } });
  if (!flag) return { key, state: "OFF" as const, source: "missing" as const };
  const pick = (scopeType: "USER" | "COMPANY" | "GROUP" | "PLATFORM", scopeId: string | undefined) => scopeId ? flag.overrides.find((row) => row.scopeType === scopeType && row.scopeId === scopeId) : undefined;
  const override = pick("USER", target.userId) ?? pick("COMPANY", target.companyId) ?? pick("GROUP", target.parentGroupId) ?? pick("PLATFORM", "platform");
  return { key, state: override?.state ?? flag.defaultState, source: override?.scopeType ?? "DEFAULT" };
}

export async function platformOperations(context: PlatformContext) {
  assertPlatform(context, "platform.operations.view");
  const [heartbeats, processes, failures, mail, outbox, storage, uploads] = await Promise.all([
    prisma.workerHeartbeat.findMany({ orderBy: { job: "asc" } }),
    prisma.workerProcess.findMany({ orderBy: [{ lastHeartbeatAt: "desc" }, { workerId: "asc" }], take: 50 }),
    prisma.jobFailure.findMany({ orderBy: [{ failedAt: "desc" }, { id: "asc" }], take: 100 }),
    prisma.mailDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.notificationEventOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.companyStorageUsage.findMany({ orderBy: [{ usedBytes: "desc" }, { companyId: "asc" }], include: { company: { select: { id: true, name: true, parentGroup: { select: { name: true } } } } } }),
    prisma.documentUploadSession.count({ where: { status: "EXPIRED" } }),
  ]);
  return {
    heartbeats: heartbeats.map((row) => ({ ...row, lastRunAt: iso(row.lastRunAt), lastSuccessAt: iso(row.lastSuccessAt), lastFailureAt: iso(row.lastFailureAt), updatedAt: row.updatedAt.toISOString() })),
    processes: processes.map((row) => ({ ...row, startedAt: row.startedAt.toISOString(), lastHeartbeatAt: row.lastHeartbeatAt.toISOString(), stoppedAt: iso(row.stoppedAt) })),
    failures: failures.map((row) => ({ ...row, failedAt: row.failedAt.toISOString(), retriedAt: iso(row.retriedAt) })),
    mail, outbox, storage: storage.map((row) => ({ ...row, usedBytes: row.usedBytes.toString(), updatedAt: row.updatedAt.toISOString() })), failedUploads: uploads,
  };
}

export async function platformDiagnostics(context: PlatformContext) {
  assertPlatform(context, "platform.operations.view");
  const [duplicateMemberships, invalidProjectManagers, unlinkedUsers, expiredUploads, rejectedDocuments, membershipRows] = await Promise.all([
    prisma.companyMember.groupBy({ by: ["companyId", "userId"], _count: { _all: true }, having: { id: { _count: { gt: 1 } } } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM projects p JOIN company_members m ON m.id = p."projectManagerMemberId" WHERE p."projectManagerMemberId" IS NOT NULL AND p."companyId" <> m."companyId"`,
    prisma.user.count({ where: { personProfileId: null, platformAccess: null } }),
    prisma.documentUploadSession.count({ where: { status: "EXPIRED" } }),
    prisma.document.count({ where: { storageStatus: { in: ["FAILED", "REJECTED"] } } }),
    prisma.companyMember.findMany({ where: { company: { parentGroup: { isTestFixture: false } }, user: { personProfile: { isNot: null } } }, select: { id: true, status: true, user: { select: { firstName: true, lastName: true, personProfile: { select: { parentGroupId: true } } } }, company: { select: { name: true, parentGroupId: true } } } }),
  ]);
  const brokenMemberships = membershipRows.filter((row) => row.user.personProfile && row.user.personProfile.parentGroupId !== row.company.parentGroupId).map((row) => ({ id: row.id, label: `${row.user.firstName} ${row.user.lastName} · ${row.company.name}`, status: row.status }));
  return [
    { key: "duplicate-memberships", label: "Duplicate memberships", count: duplicateMemberships.length, severity: "CRITICAL" },
    { key: "project-manager-company", label: "Invalid Project manager bindings", count: Number(invalidProjectManagers[0]?.count ?? 0), severity: "CRITICAL" },
    { key: "unlinked-users", label: "Tenant accounts without a Person", count: unlinkedUsers, severity: "WARNING" },
    { key: "expired-uploads", label: "Expired upload sessions", count: expiredUploads, severity: "WARNING" },
    { key: "failed-documents", label: "Failed or rejected documents", count: rejectedDocuments, severity: "WARNING" },
    { key: "cross-group-memberships", label: "Cross-group memberships", count: brokenMemberships.length, severity: "CRITICAL", items: brokenMemberships },
  ];
}

export async function platformHealth(context: PlatformContext) {
  assertPlatform(context, "platform.operations.view");
  const now = Date.now();
  const [processes, heartbeats, failedMail, pendingNotifications, maintenance, storage] = await Promise.all([
    prisma.workerProcess.findMany({ where: { status: "RUNNING" }, select: { lastHeartbeatAt: true } }),
    prisma.workerHeartbeat.findMany({ select: { lastSuccessAt: true, lastFailureAt: true, consecutiveFailures: true } }),
    prisma.mailDelivery.count({ where: { status: "FAILED" } }),
    prisma.notificationEventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    getMaintenanceState(),
    storageProvider().healthCheck().catch(() => ({ ok: false })),
  ]);
  const workersFresh = processes.some((row) => now - row.lastHeartbeatAt.getTime() < 120_000);
  const jobsFailed = heartbeats.some((row) => row.consecutiveFailures > 0 && (!row.lastSuccessAt || (row.lastFailureAt?.getTime() ?? 0) > row.lastSuccessAt.getTime()));
  return [
    { service: "Application", state: maintenance.enabled ? "DEGRADED" : "HEALTHY", detail: maintenance.enabled ? "Maintenance mode enabled" : "Control plane responding" },
    { service: "Database", state: "HEALTHY", detail: "Control-plane queries responding" },
    { service: "Authentication", state: maintenance.disableNewLogins ? "DEGRADED" : "HEALTHY", detail: maintenance.disableNewLogins ? "New tenant logins disabled" : "Session store responding" },
    { service: "Storage", state: storage.ok ? "HEALTHY" : "DOWN", detail: storage.ok ? `${storageProvider().key} provider reachable` : "Storage provider health check failed" },
    { service: "Background Jobs", state: !workersFresh ? "UNKNOWN" : jobsFailed ? "DEGRADED" : "HEALTHY", detail: workersFresh ? (jobsFailed ? "Recent job failures" : "Worker heartbeat current") : "No recent worker heartbeat" },
    { service: "Notifications", state: pendingNotifications > 100 ? "DEGRADED" : "HEALTHY", detail: `${pendingNotifications} queued` },
    { service: "Email", state: failedMail ? "DEGRADED" : "HEALTHY", detail: `${failedMail} failed deliveries` },
    { service: "3D Processing", state: maintenance.disable3DProcessing ? "DEGRADED" : "HEALTHY", detail: maintenance.disable3DProcessing ? "Processing disabled" : "Processing enabled" },
  ];
}

export async function platformSecurity(context: PlatformContext) {
  assertPlatform(context, "platform.security.view");
  const [failedLogins, accessChanges] = await Promise.all([
    prisma.authEvent.findMany({ where: { type: { in: ["LOGIN_FAILED", "LOGIN_RATE_LIMITED", "ACCOUNT_BLOCKED", "MEMBERSHIP_DENIED"] } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100, select: { id: true, type: true, ipAddress: true, userAgent: true, metadata: true, createdAt: true, user: { select: { username: true, firstName: true, lastName: true } } } }),
    prisma.auditEvent.findMany({ where: { category: "ACCESS_CONTROL" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, actionKey: true, actorDisplayNameSnapshot: true, entityType: true, entityLabelSnapshot: true, reason: true, severity: true, occurredAt: true } }),
  ]);
  return { failedLogins: failedLogins.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), accessChanges: accessChanges.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })) };
}

/** How many of the newest audit events the platform audit pages show; each states it with its total (AUD-08 §4). */
export const PLATFORM_AUDIT_SHOWN = 250;

/**
 * The newest audit events, optionally of some categories only. The category is
 * a filter in the query — before the cap, never after it — so the security page
 * shows the newest 250 security events rather than the security events among
 * the newest 250 of any kind (AUD-08 §3). `total` is every matching event, from
 * the same snapshot, so the page can say "the newest N of M".
 */
export async function platformAuditPage(context: PlatformContext, categories?: AuditCategory[]) {
  assertPlatform(context, "platform.audit.view");
  const where: Prisma.AuditEventWhereInput = categories?.length ? { category: { in: categories } } : {};
  const { rows, total } = await runInTransaction(
    "platform.audit.list",
    async (tx) => ({
      total: await tx.auditEvent.count({ where }),
      rows: await tx.auditEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: PLATFORM_AUDIT_SHOWN, select: AUDIT_ROW_SELECT }),
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 },
  );
  return { rows: rows.map(({ metadataJson, ...row }) => ({ ...row, summary: auditSummary(metadataJson), occurredAt: row.occurredAt.toISOString() })), total };
}

export async function platformAudit(context: PlatformContext) {
  return (await platformAuditPage(context)).rows;
}

const AUDIT_ROW_SELECT = { id: true, actionKey: true, moduleKey: true, category: true, severity: true, actorDisplayNameSnapshot: true, actorRoleSnapshot: true, entityType: true, entityId: true, entityLabelSnapshot: true, parentGroupId: true, companyId: true, projectId: true, reason: true, metadataJson: true, occurredAt: true, requestId: true } satisfies Prisma.AuditEventSelect;

/** The system-written change summary an event carries, if any; only that string leaves the query. */
function auditSummary(metadata: Prisma.JsonValue | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const summary = (metadata as Record<string, unknown>).summary;
  return typeof summary === "string" ? summary.slice(0, 200) : null;
}

export const PLATFORM_SETTING_DEFAULTS = {
  "general.platformName": "NESTO",
  "general.platformUrl": "http://localhost:3000",
  "general.supportContact": "support@nesto.local",
  "localization.defaultLanguage": "en",
  "localization.defaultCurrency": "EUR",
  "localization.defaultTimezone": "Europe/Tirane",
  "branding.logoUrl": "",
  "branding.faviconUrl": "/favicon.ico",
  "maintenance.enabled": false,
  "maintenance.readOnly": false,
  "maintenance.disableUploads": false,
  "maintenance.disableNewLogins": false,
  "maintenance.disable3DProcessing": false,
} as const;

export async function platformSettings(context: PlatformContext) {
  assertPlatform(context, "platform.settings.view");
  const rows = await prisma.platformSetting.findMany({ orderBy: [{ category: "asc" }, { key: "asc" }] });
  const values: Record<string, unknown> = { ...PLATFORM_SETTING_DEFAULTS };
  for (const row of rows) values[row.key] = row.value;
  return { values, rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
}

export async function maintenanceState() {
  return getMaintenanceState();
}

export async function platformSupport(context: PlatformContext) {
  assertPlatform(context, "platform.support.view");
  const now = new Date();
  const [groups, companies, users, projects, sessions] = await Promise.all([
    prisma.parentGroup.findMany({ where: { isTestFixture: false, kind: "GROUP" }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.company.findMany({ where: { parentGroup: { isTestFixture: false } }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, parentGroupId: true } }),
    prisma.user.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, username: true, firstName: true, lastName: true, status: true } }),
    prisma.project.findMany({ where: { company: { parentGroup: { isTestFixture: false } } }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, companyId: true, status: true } }),
    prisma.supportAccessSession.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 }),
  ]);
  return { groups, companies, users, projects, sessions: sessions.map((row) => ({ ...row, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), active: !row.revokedAt && row.expiresAt > now })) };
}

export async function platformSearch(context: PlatformContext, query: string) {
  assertPlatform(context, "platform.dashboard.view");
  const q = query.trim();
  if (q.length < 2) return [];
  const contains = { contains: q, mode: "insensitive" as const };
  const [groups, companies, people, users, projects] = await Promise.all([
    prisma.parentGroup.findMany({ where: { isTestFixture: false, kind: "GROUP", OR: [{ name: contains }, { slug: contains }] }, take: 6, select: { id: true, name: true, slug: true } }),
    prisma.company.findMany({ where: { parentGroup: { isTestFixture: false }, OR: [{ name: contains }, { slug: contains }] }, take: 6, select: { id: true, name: true, slug: true, parentGroup: { select: { kind: true, name: true } } } }),
    prisma.personProfile.findMany({ where: { parentGroup: { isTestFixture: false }, OR: [{ firstName: contains }, { lastName: contains }, { workEmail: contains }] }, take: 6, select: { id: true, firstName: true, lastName: true, parentGroup: { select: { name: true } } } }),
    prisma.user.findMany({ where: { OR: [{ username: contains }, { firstName: contains }, { lastName: contains }] }, take: 6, select: { id: true, username: true, firstName: true, lastName: true } }),
    prisma.project.findMany({ where: { company: { parentGroup: { isTestFixture: false } }, OR: [{ name: contains }, { code: contains }] }, take: 6, select: { id: true, name: true, code: true, company: { select: { name: true } } } }),
  ]);
  return [
    ...groups.map((row) => ({ type: "Group", id: row.id, title: row.name, subtitle: row.slug, href: `/admin/organizations/${row.id}` })),
    ...companies.map((row) => ({ type: "Company", id: row.id, title: row.name, subtitle: row.parentGroup.kind === "STANDALONE" ? "Standalone company" : row.parentGroup.name, href: `/admin/organizations/${row.id}` })),
    ...projects.map((row) => ({ type: "Project", id: row.id, title: row.name, subtitle: `${row.company.name} · ${row.code}`, href: `/admin/projects/${row.id}` })),
    ...users.map((row) => ({ type: "User", id: row.id, title: `${row.firstName} ${row.lastName}`, subtitle: row.username, href: `/admin/users?q=${encodeURIComponent(row.username)}` })),
    ...people.map((row) => ({ type: "Person", id: row.id, title: `${row.firstName} ${row.lastName}`, subtitle: row.parentGroup.name, href: "/admin/users/people" })),
  ].slice(0, 20);
}

export { MODULE_KEYS };
