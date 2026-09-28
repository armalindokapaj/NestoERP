import { modules as moduleRegistry } from "@/config/modules";
import { AccessError } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { prisma } from "@/lib/database/prisma";
import { platformHealth } from "@/lib/modules/platform/platform-control.query";

/**
 * The Platform Admin Dashboard's data (Dashboard PRD §39-§43, §66, §67).
 *
 * One function per section so each renders as soon as its own data lands and
 * fails alone. Every number is a database count or aggregate; lists are
 * bounded and read their relations in one batch, never per row. Test-fixture
 * tenants are excluded everywhere, as in the directories, so the Dashboard and
 * the directory it links to agree.
 */

function assertDashboard(context: PlatformContext): void {
  if (!canPlatform(context, "platform.dashboard.view")) throw new AccessError("FORBIDDEN");
}

const REAL = { isTestFixture: false } as const;
const REAL_GROUP = { ...REAL, kind: "GROUP" } as const;
const REAL_COMPANY = { parentGroup: REAL } as const;

export type Severity = "critical" | "warning" | "info";

/** One thing a Platform Admin should act on, whatever produced it (§49). */
export type AttentionItem = {
  id: string;
  severity: Severity;
  title: string;
  entity: string | null;
  description: string;
  at: string | null;
  href: string;
  actionLabel: string;
};

// ── Summary (§6-§10) ─────────────────────────────────────────────────────────

export async function dashboardSummary(context: PlatformContext) {
  assertDashboard(context);
  const [groups, companies, standalone, projects, users] = await Promise.all([
    prisma.parentGroup.count({ where: { ...REAL_GROUP, status: { not: "ARCHIVED" } } }),
    prisma.company.count({ where: REAL_COMPANY }),
    prisma.company.count({ where: { parentGroup: { ...REAL, kind: "STANDALONE" } } }),
    prisma.project.groupBy({ by: ["status"], where: { company: REAL_COMPANY, archivedAt: null }, _count: { _all: true } }),
    // Accounts, not people: an employee without a login is not a user (§10).
    prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const projectCount = (status: string) => projects.find((row) => row.status === status)?._count._all ?? 0;
  const userCount = (status: string) => users.find((row) => row.status === status)?._count._all ?? 0;
  const liveProjects = projects.filter((row) => row.status !== "ARCHIVED").reduce((sum, row) => sum + row._count._all, 0);
  return {
    organizations: { total: groups + companies, groups, companies, standalone },
    projects: { total: liveProjects, active: projectCount("ACTIVE"), pending: projectCount("PENDING"), finished: projectCount("FINISHED") },
    users: { total: users.reduce((sum, row) => sum + row._count._all, 0), active: userCount("ACTIVE"), inactive: userCount("INACTIVE"), suspended: userCount("SUSPENDED") },
  };
}

/**
 * The platform's state from the checks NESTO actually runs (§6): Attention
 * required when one of them fails, Operational when every verified one passes.
 * A check that cannot report (no worker heartbeat) is named, not counted as
 * healthy.
 */
export async function dashboardPlatformStatus(context: PlatformContext) {
  assertDashboard(context);
  if (!canPlatform(context, "platform.operations.view")) return { state: "UNAVAILABLE" as const, failing: [], unverified: [] };
  const checks = await platformHealth(context);
  const failing = checks.filter((row) => row.state === "DOWN" || row.state === "DEGRADED").map((row) => ({ service: row.service, detail: row.detail, state: row.state }));
  const unverified = checks.filter((row) => row.state === "UNKNOWN").map((row) => row.service);
  return { state: failing.length ? "ATTENTION" as const : "OPERATIONAL" as const, failing, unverified };
}

// ── Attention required (§11-§14, §49-§51) ────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Current problems only: each source is read in its present state, so a
 * resolved problem (a retried job, a replaced model, a reactivated company)
 * drops out by itself rather than lingering (§50, §51).
 */
export async function dashboardAttention(context: PlatformContext, limit = 5): Promise<{ items: AttentionItem[]; total: number }> {
  assertDashboard(context);
  const [health, suspendedGroups, suspendedCompanies, validation, failedModels, failedJobs, failedMail, quotas] = await Promise.all([
    canPlatform(context, "platform.operations.view") ? platformHealth(context) : Promise.resolve([]),
    prisma.parentGroup.findMany({ where: { ...REAL_GROUP, status: "SUSPENDED" }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, name: true, updatedAt: true } }),
    prisma.company.findMany({ where: { ...REAL_COMPANY, status: "SUSPENDED" }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, name: true, updatedAt: true } }),
    prisma.parentGroup.findMany({ where: { ...REAL_GROUP, status: "READY_FOR_VALIDATION" }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, name: true, updatedAt: true } }),
    // A failed model matters while it is still the latest upload in its slot.
    prisma.project3DModelVersion.findMany({
      where: { status: "FAILED", project: { company: REAL_COMPANY }, slot: { versions: { none: { status: { in: ["UPLOADED", "PROCESSING", "READY", "PUBLISHED"] } } } } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, originalFileName: true, createdAt: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.jobFailure.groupBy({ by: ["jobKey"], where: { retriedAt: null }, _count: { _all: true }, _max: { failedAt: true } }),
    prisma.mailDelivery.count({ where: { status: "FAILED" } }),
    prisma.companyStorageQuota.findMany({ where: { maxStorageBytes: { not: null }, company: REAL_COMPANY }, select: { companyId: true, maxStorageBytes: true, company: { select: { name: true, storageUsage: { select: { usedBytes: true } } } } } }),
  ]);

  const items: AttentionItem[] = [];
  for (const row of health) {
    if (row.state !== "DOWN" && row.state !== "DEGRADED") continue;
    // Email is reported below with its own count.
    if (row.service === "Email") continue;
    items.push({ id: `health:${row.service}`, severity: row.state === "DOWN" ? "critical" : "warning", title: `${row.service} ${row.state === "DOWN" ? "unavailable" : "degraded"}`, entity: null, description: row.detail, at: null, href: "/admin/system/health", actionLabel: "Review" });
  }
  for (const row of failedModels) {
    items.push({ id: `model:${row.id}`, severity: "critical", title: "3D model processing failed", entity: row.project.name, description: `${row.originalFileName} could not be prepared. Replace or re-upload the model.`, at: row.createdAt.toISOString(), href: `/admin/3d/projects/${row.projectId}/models`, actionLabel: "Review" });
  }
  for (const row of failedJobs) {
    items.push({ id: `job:${row.jobKey}`, severity: "critical", title: "Background job failing", entity: row.jobKey, description: `${row._count._all} failed run${row._count._all === 1 ? "" : "s"} not yet retried.`, at: row._max.failedAt?.toISOString() ?? null, href: "/admin/system/jobs", actionLabel: "Review" });
  }
  if (failedMail) {
    items.push({ id: "mail", severity: "warning", title: "Email delivery failures", entity: null, description: `${failedMail} message${failedMail === 1 ? "" : "s"} could not be delivered. Password reset email may be affected.`, at: null, href: "/admin/system/health", actionLabel: "Review" });
  }
  for (const row of quotas) {
    const max = Number(row.maxStorageBytes);
    const used = Number(row.company.storageUsage?.usedBytes ?? 0);
    const share = max > 0 ? used / max : 0;
    if (share < STORAGE_WARNING) continue;
    items.push({ id: `storage:${row.companyId}`, severity: share >= STORAGE_CRITICAL ? "critical" : "warning", title: "Storage quota nearly used", entity: row.company.name, description: `${Math.round(share * 100)}% of the company's storage quota is in use.`, at: null, href: "/admin/system/storage", actionLabel: "Review" });
  }
  for (const row of suspendedGroups) {
    items.push({ id: `group:${row.id}`, severity: "warning", title: "Group suspended", entity: row.name, description: "Its companies' users cannot sign in until it is reactivated.", at: row.updatedAt.toISOString(), href: `/admin/organizations/${row.id}`, actionLabel: "Open" });
  }
  for (const row of suspendedCompanies) {
    items.push({ id: `company:${row.id}`, severity: "warning", title: "Company suspended", entity: row.name, description: "Its users cannot work in it until it is reactivated.", at: row.updatedAt.toISOString(), href: `/admin/organizations/${row.id}`, actionLabel: "Open" });
  }
  for (const row of validation) {
    items.push({ id: `validation:${row.id}`, severity: "info", title: "Implementation ready for validation", entity: row.name, description: "The group's setup is complete and waits for handover.", at: row.updatedAt.toISOString(), href: `/admin/organizations/${row.id}`, actionLabel: "Validate" });
  }
  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.at ?? "").localeCompare(a.at ?? ""));
  return { items: items.slice(0, limit), total: items.length };
}

/** Storage thresholds, as shares of a real quota (§29). */
export const STORAGE_WARNING = 0.75;
export const STORAGE_CRITICAL = 0.9;

// ── Recent activity (§15-§17, §48) ──────────────────────────────────────────

const ENTITY_HREF: Record<string, (id: string) => string> = {
  Company: (id) => `/admin/organizations/${id}`,
  ParentGroup: (id) => `/admin/organizations/${id}`,
  Project: (id) => `/admin/projects/${id}`,
};

/** "PLATFORM_COMPANY_CREATED" → "Company created". */
export function activityLabel(actionKey: string): string {
  const words = actionKey.replace(/^PLATFORM_/, "").toLowerCase().split("_").filter(Boolean);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Platform mutations from the canonical audit trail; the audit trail records
 * no page views, so nothing here is navigation noise (§16).
 */
export async function dashboardActivity(context: PlatformContext, limit = 6) {
  assertDashboard(context);
  const rows = await prisma.auditEvent.findMany({
    where: { moduleKey: "platform" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, actionKey: true, entityType: true, entityId: true, entityLabelSnapshot: true, actorDisplayNameSnapshot: true, occurredAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    label: activityLabel(row.actionKey),
    entity: row.entityLabelSnapshot,
    actor: row.actorDisplayNameSnapshot,
    at: row.occurredAt.toISOString(),
    href: row.entityId && row.entityType && ENTITY_HREF[row.entityType] ? ENTITY_HREF[row.entityType](row.entityId) : "/admin/audit",
  }));
}

// ── Organizations and projects (§18-§23, §68) ───────────────────────────────

export type DashboardOrganization = { id: string; name: string; type: "Group" | "Standalone company"; companies: number | null; projects: number; users: number; status: string; createdAt: string };

/** The most recently created Groups and standalone Companies, five in all (§18). */
export async function dashboardOrganizations(context: PlatformContext, limit = 5): Promise<DashboardOrganization[]> {
  assertDashboard(context);
  const [groups, standalone] = await Promise.all([
    prisma.parentGroup.findMany({ where: REAL_GROUP, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, select: { id: true, name: true, status: true, createdAt: true, _count: { select: { companies: true } } } }),
    prisma.company.findMany({ where: { parentGroup: { ...REAL, kind: "STANDALONE" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, select: { id: true, name: true, status: true, createdAt: true, parentGroupId: true } }),
  ]);
  const picked = [
    ...groups.map((row) => ({ kind: "group" as const, row })),
    ...standalone.map((row) => ({ kind: "company" as const, row })),
  ].sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime()).slice(0, limit);
  const rootIds = picked.map((item) => (item.kind === "group" ? item.row.id : (item.row as { parentGroupId: string }).parentGroupId));
  if (!rootIds.length) return [];
  // One batch for every row: projects and distinct account holders per root.
  const [projects, members] = await Promise.all([
    prisma.project.findMany({ where: { archivedAt: null, company: { parentGroupId: { in: rootIds } } }, select: { company: { select: { parentGroupId: true } } } }),
    prisma.companyMember.findMany({ where: { status: "ACTIVE", company: { parentGroupId: { in: rootIds } } }, select: { userId: true, company: { select: { parentGroupId: true } } } }),
  ]);
  const projectsBy = new Map<string, number>();
  for (const row of projects) projectsBy.set(row.company.parentGroupId, (projectsBy.get(row.company.parentGroupId) ?? 0) + 1);
  const usersBy = new Map<string, Set<string>>();
  for (const row of members) {
    const set = usersBy.get(row.company.parentGroupId) ?? new Set<string>();
    set.add(row.userId);
    usersBy.set(row.company.parentGroupId, set);
  }
  return picked.map((item, index) => {
    const root = rootIds[index];
    return {
      id: item.row.id,
      name: item.row.name,
      type: item.kind === "group" ? "Group" as const : "Standalone company" as const,
      companies: item.kind === "group" ? (item.row as { _count: { companies: number } })._count.companies : null,
      projects: projectsBy.get(root) ?? 0,
      users: usersBy.get(root)?.size ?? 0,
      status: item.row.status,
      createdAt: item.row.createdAt.toISOString(),
    };
  });
}

/** The 3D audience, kept apart from the project's own lifecycle (§9, §21, §22). */
export function threeDState(config: { visibility: string; deletedAt: Date | null } | null): string {
  if (!config) return "Not configured";
  if (config.deletedAt) return "Deleted";
  return config.visibility === "PUBLIC" ? "Public" : config.visibility === "COMPANY_ONLY" ? "Company only" : "Offline";
}

export async function dashboardProjects(context: PlatformContext, limit = 5) {
  assertDashboard(context);
  const rows = await prisma.project.findMany({
    where: { company: REAL_COMPANY, archivedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, name: true, status: true, company: { select: { id: true, name: true } }, project3DConfig: { select: { visibility: true, deletedAt: true } } },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, status: row.status, company: row.company, threeD: threeDState(row.project3DConfig), has3D: Boolean(row.project3DConfig && !row.project3DConfig.deletedAt) }));
}

// ── Usage (§27-§31) ─────────────────────────────────────────────────────────

export async function dashboardUsage(context: PlatformContext) {
  assertDashboard(context);
  const [storage, quota, moduleAssignments, companiesWithModules, visibility] = await Promise.all([
    prisma.companyStorageUsage.aggregate({ where: { company: REAL_COMPANY }, _sum: { usedBytes: true } }),
    prisma.companyStorageQuota.aggregate({ where: { company: REAL_COMPANY, maxStorageBytes: { not: null } }, _sum: { maxStorageBytes: true }, _count: { _all: true } }),
    prisma.companyModule.count({ where: { enabled: true, company: REAL_COMPANY } }),
    prisma.company.count({ where: REAL_COMPANY }),
    prisma.project3DConfig.groupBy({ by: ["visibility"], where: { deletedAt: null, project: { company: REAL_COMPANY } }, _count: { _all: true } }),
  ]);
  const count = (key: string) => visibility.find((row) => row.visibility === key)?._count._all ?? 0;
  // A platform-wide quota exists only when every company has one (§28).
  const quotaBytes = quota._count._all > 0 && quota._count._all === companiesWithModules ? Number(quota._sum.maxStorageBytes ?? 0) : null;
  return {
    storage: { usedBytes: Number(storage._sum.usedBytes ?? 0), quotaBytes },
    modules: { available: Object.keys(moduleRegistry).length, assignments: moduleAssignments },
    threeD: { configured: visibility.reduce((sum, row) => sum + row._count._all, 0), public: count("PUBLIC"), companyOnly: count("COMPANY_ONLY"), offline: count("OFFLINE") },
  };
}
