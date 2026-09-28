import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { modules as registry, type ModuleKey } from "@/config/modules";
import { type PlatformPermission } from "@/config/platform";
import { AccessError, assertFound } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import {
  ENTITLABLE_MODULES, ENTITLEMENT_DEPENDENCIES, REQUIRED_MODULES, loadEntitlementSources, missingDependencies, moduleLabel, resolveCompany, type EntitlementState,
} from "@/lib/core/entitlements/entitlement.resolver";

/**
 * Platform Admin entitlement administration (Admin Modules PRD #4).
 *
 * The platform decides what a company may use — its plan, its per-module
 * exceptions, its limits. The company decides how it uses what it was given.
 * Nothing here deletes business data: a module leaving the plan only stops
 * being reachable, and comes back with its records when granted again (§18,
 * §73, §74).
 */

type Db = Prisma.TransactionClient | typeof prisma;

function assertPlatform(context: PlatformContext, permission: PlatformPermission): void {
  if (!canPlatform(context, permission)) throw new AccessError("FORBIDDEN");
}

const REAL_COMPANY = { parentGroup: { isTestFixture: false } } as const;
const DEFAULT_PLAN_KEY = "full";

/** Every new company holds the default plan from its first transaction (§86). */
export async function ensureCompanyEntitlement(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  const plan = await tx.entitlementPlan.findUnique({ where: { key: DEFAULT_PLAN_KEY }, select: { id: true, maxActiveUsers: true, maxProjects: true } });
  await tx.companyEntitlement.upsert({
    where: { companyId },
    update: {},
    create: { companyId, planId: plan?.id ?? null, maxActiveUsers: plan?.maxActiveUsers ?? null, maxProjects: plan?.maxProjects ?? null },
  });
}

// ── Limits (§47-§51) ────────────────────────────────────────────────────────

export type LimitKind = "users" | "projects";

/**
 * Refuses a new active user or project past the company's limit (§49). Called
 * inside the creating transaction, so two concurrent creations cannot both
 * slip under it unnoticed by the same read.
 */
export async function assertWithinLimit(db: Db, companyId: string, kind: LimitKind): Promise<void> {
  const row = await db.companyEntitlement.findUnique({ where: { companyId }, select: { maxActiveUsers: true, maxProjects: true } });
  const limit = kind === "users" ? row?.maxActiveUsers : row?.maxProjects;
  if (limit === null || limit === undefined) return;
  const used = kind === "users"
    ? await db.companyMember.count({ where: { companyId, status: "ACTIVE" } })
    : await db.project.count({ where: { companyId, archivedAt: null } });
  if (used >= limit) {
    throw new AccessError("CONFLICT", kind === "users" ? `Active user limit reached (${used} / ${limit}). Ask NESTO to raise it.` : `Project limit reached (${used} / ${limit}). Ask NESTO to raise it.`, { code: kind === "users" ? "USER_LIMIT_REACHED" : "PROJECT_LIMIT_REACHED" });
  }
}

// ── Plans (§24-§27) ─────────────────────────────────────────────────────────

export async function listEntitlementPlans(context: PlatformContext) {
  assertPlatform(context, "platform.module.view");
  const rows = await prisma.entitlementPlan.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { _count: { select: { companies: true } } } });
  return rows.map((row) => ({
    id: row.id, key: row.key, name: row.name, description: row.description, status: row.status, moduleKeys: row.moduleKeys,
    maxActiveUsers: row.maxActiveUsers, maxProjects: row.maxProjects, maxStorageBytes: row.maxStorageBytes === null ? null : Number(row.maxStorageBytes), companies: row._count.companies,
  }));
}

/** Blank or absent is Unlimited (§48); anything else a positive number. */
const limit = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((value) => (value === undefined || value === null || value === "" ? null : Number(value)), schema.nullable());

export const planSchema = z.object({
  name: z.string().trim().min(2).max(80),
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, "Use lowercase letters, digits and hyphens").optional(),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  moduleKeys: z.array(z.enum(ENTITLABLE_MODULES as [ModuleKey, ...ModuleKey[]])).max(ENTITLABLE_MODULES.length),
  maxActiveUsers: limit(z.number().int().min(1)),
  maxProjects: limit(z.number().int().min(1)),
  maxStorageGb: limit(z.number().min(1).max(1_000_000)),
  status: z.enum(["ACTIVE", "RETIRED"]).default("ACTIVE"),
});

/** Creates or edits a plan template. Companies already on it gain or lose its modules at once (§24, §38). */
export async function savePlan(context: PlatformContext, planId: string | null, raw: unknown): Promise<{ id: string }> {
  assertPlatform(context, "platform.module.manage");
  const input = planSchema.parse(raw);
  const problems = missingDependencies(new Set(input.moduleKeys));
  if (problems.length) throw new AccessError("VALIDATION_ERROR", dependencyMessage(problems), { code: "MODULE_DEPENDENCY_BLOCKED" });
  const maxStorageBytes = input.maxStorageGb === null ? null : BigInt(Math.round(input.maxStorageGb * 1024 ** 3));
  return prisma.$transaction(async (tx) => {
    const before = planId ? assertFound(await tx.entitlementPlan.findUnique({ where: { id: planId } })) : null;
    const key = before?.key ?? input.key ?? input.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!before && (await tx.entitlementPlan.count({ where: { key } }))) throw new AccessError("CONFLICT", "Another plan already uses that key.", { field: "key" });
    // A plan's status is its own availability for new assignments; any status may follow any other (§38).
    const plan = before
      ? await tx.entitlementPlan.update({ where: { id: before.id, status: before.status }, data: { name: input.name, description: input.description || null, moduleKeys: input.moduleKeys, status: input.status, maxActiveUsers: input.maxActiveUsers, maxProjects: input.maxProjects, maxStorageBytes } })
      : await tx.entitlementPlan.create({ data: { key, name: input.name, description: input.description || null, moduleKeys: input.moduleKeys, status: input.status, maxActiveUsers: input.maxActiveUsers, maxProjects: input.maxProjects, maxStorageBytes } });
    // Every company on the plan reads its modules afresh.
    await tx.company.updateMany({ where: { entitlement: { planId: plan.id } }, data: { configVersion: { increment: 1 } } });
    await recordPlatformAction(context, await platformRoot(tx), {
      actionKey: AuditAction.PLATFORM_ENTITLEMENT_PLAN_SAVED,
      entity: { type: "EntitlementPlan", id: plan.id, label: plan.name },
      before: before ? { key: before.key, name: before.name, moduleKeys: before.moduleKeys.join(", "), status: before.status } : undefined,
      after: { key: plan.key, name: plan.name, moduleKeys: plan.moduleKeys.join(", "), status: plan.status },
    }, { tx });
    return { id: plan.id };
  });
}

/**
 * Platform-wide records (a plan belongs to no tenant) are audited on the
 * oldest real group's root, as other platform-wide actions are; with no
 * group yet, on any root.
 */
async function platformRoot(db: Db): Promise<string> {
  const root = await db.parentGroup.findFirst({ where: { isTestFixture: false }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }], select: { id: true } });
  if (!root) throw new AccessError("CONFLICT", "Create an organization before managing plans.");
  return root.id;
}

// ── Directories (§10-§12, §35, §36, §58, §59) ──────────────────────────────

export const entitlementDirectorySchema = z.object({
  q: z.string().trim().max(120).catch(""),
  plan: z.string().trim().max(64).catch(""),
  group: z.string().trim().max(128).catch(""),
  status: z.enum(["", "ACTIVE", "INACTIVE", "SUSPENDED"]).catch(""),
  module: z.string().trim().max(40).catch(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
const PAGE = 25;

/** "What does this company have?" — one row per company, counts batched (§11, §80, §81). */
export async function entitlementDirectory(context: PlatformContext, raw: Record<string, unknown>) {
  assertPlatform(context, "platform.module.view");
  const query = entitlementDirectorySchema.parse(raw);
  const contains = query.q ? { contains: query.q, mode: "insensitive" as const } : undefined;
  const where: Prisma.CompanyWhereInput = {
    parentGroup: { isTestFixture: false, ...(query.group ? { id: query.group, kind: "GROUP" } : {}) },
    ...(contains ? { OR: [{ name: contains }, { slug: contains }, { parentGroup: { name: contains, kind: "GROUP" } }] } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.plan === "custom" ? { OR: [{ entitlement: null }, { entitlement: { planId: null } }] } : query.plan ? { entitlement: { planId: query.plan } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, status: true, parentGroup: { select: { id: true, name: true, kind: true } }, entitlement: { select: { plan: { select: { id: true, name: true } } } }, _count: { select: { projects: { where: { archivedAt: null } } } } },
    }),
  ]);
  const sources = await loadEntitlementSources(rows.map((row) => row.id));
  const now = new Date();
  let list = rows.map((row) => {
    const resolved = resolveCompany(sources.get(row.id) ?? null, now);
    return {
      id: row.id, name: row.name, status: row.status,
      parentGroup: row.parentGroup.kind === "GROUP" ? { id: row.parentGroup.id, name: row.parentGroup.name } : null,
      plan: row.entitlement === null ? "Full NESTO" : row.entitlement.plan?.name ?? "Custom",
      modules: resolved.filter((item) => item.entitled && item.source !== "core").length,
      trials: resolved.filter((item) => item.state === "Trial").length,
      entitledKeys: resolved.filter((item) => item.entitled).map((item) => item.key),
      projects: row._count.projects,
    };
  });
  if (query.module) list = list.filter((row) => row.entitledKeys.includes(query.module as ModuleKey));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const page = Math.min(query.page, pages);
  return { query: { ...query, page }, total: query.module ? list.length : total, pages, rows: list.slice((page - 1) * PAGE, page * PAGE).map((row) => ({ id: row.id, name: row.name, status: row.status, parentGroup: row.parentGroup, plan: row.plan, modules: row.modules, trials: row.trials, projects: row.projects })) };
}

/** Each module with how many companies may use it (§35-§37). */
export async function moduleCatalog(context: PlatformContext) {
  assertPlatform(context, "platform.module.view");
  const companies = await prisma.company.findMany({ where: REAL_COMPANY, select: { id: true } });
  const sources = await loadEntitlementSources(companies.map((row) => row.id));
  const now = new Date();
  const counts = new Map<string, { enabled: number; trial: number }>();
  for (const source of sources.values()) {
    for (const item of resolveCompany(source, now)) {
      const entry = counts.get(item.key) ?? { enabled: 0, trial: 0 };
      if (item.entitled) entry.enabled += 1;
      if (item.state === "Trial") entry.trial += 1;
      counts.set(item.key, entry);
    }
  }
  const available = new Map((await prisma.module.findMany({ select: { key: true, status: true } })).map((row) => [row.key, row.status]));
  const threeD = await prisma.project3DEntitlement.count({ where: { status: "ACTIVE", project: { company: REAL_COMPANY } } });
  return {
    companies: companies.length,
    modules: [
      ...Object.values(registry).map((definition) => ({
        key: definition.key,
        name: definition.label,
        description: definition.description,
        scope: (REQUIRED_MODULES as readonly string[]).includes(definition.key) ? "Required" as const : "Company" as const,
        dependencies: (ENTITLEMENT_DEPENDENCIES[definition.key] ?? []).map(moduleLabel),
        availability: available.get(definition.key) === "INACTIVE" ? "Not offered" : "Available",
        enabled: counts.get(definition.key)?.enabled ?? 0,
        trial: counts.get(definition.key)?.trial ?? 0,
      })),
      // Granted per project, by 3D administration (§7, §40-§44).
      { key: "viewer3d", name: "3D Viewer", description: "The published 3D experience of a project, for its company's users or the public.", scope: "Project" as const, dependencies: [moduleLabel("projects")], availability: "Available", enabled: threeD, trial: 0 },
    ],
  };
}

/** The companies holding one module (§36). */
export async function moduleHolders(context: PlatformContext, moduleKey: string) {
  assertPlatform(context, "platform.module.view");
  if (!(moduleKey in registry)) throw new AccessError("NOT_FOUND");
  const companies = await prisma.company.findMany({
    where: REAL_COMPANY,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, status: true, parentGroup: { select: { name: true, kind: true } }, entitlement: { select: { updatedAt: true, plan: { select: { name: true } } } } },
  });
  const sources = await loadEntitlementSources(companies.map((row) => row.id));
  const now = new Date();
  return companies.flatMap((row) => {
    const item = resolveCompany(sources.get(row.id) ?? null, now).find((entry) => entry.key === moduleKey);
    if (!item?.entitled) return [];
    return [{ id: row.id, name: row.name, status: row.status, group: row.parentGroup.kind === "GROUP" ? row.parentGroup.name : null, plan: row.entitlement === null ? "Full NESTO" : row.entitlement.plan?.name ?? "Custom", state: item.state, since: item.override?.startsAt?.toISOString() ?? null }];
  });
}

// ── One company (§13-§16, §40, §41, §47, §53) ───────────────────────────────

const ENTITLEMENT_ACTIONS = ["PLATFORM_ENTITLEMENTS_CHANGED", "PLATFORM_ENTITLEMENT_LIMITS_CHANGED", "PLATFORM_MODULE_SET"];

export async function getCompanyEntitlements(context: PlatformContext, companyId: string) {
  assertPlatform(context, "platform.module.view");
  const company = assertFound(await prisma.company.findFirst({
    where: { id: companyId, ...REAL_COMPANY },
    select: {
      id: true, name: true, status: true, parentGroupId: true, parentGroup: { select: { id: true, name: true, kind: true } },
      entitlement: { select: { version: true, planId: true, maxActiveUsers: true, maxProjects: true, plan: { select: { name: true } } } },
      storageQuota: { select: { maxStorageBytes: true } }, storageUsage: { select: { usedBytes: true } },
    },
  }));
  const [sources, switches, users, projects, history] = await Promise.all([
    loadEntitlementSources([companyId]),
    prisma.companyModule.findMany({ where: { companyId }, select: { enabled: true, module: { select: { key: true } } } }),
    prisma.companyMember.count({ where: { companyId, status: "ACTIVE" } }),
    prisma.project.findMany({ where: { companyId, archivedAt: null }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, code: true, status: true, project3DEntitlement: { select: { status: true, viewerEnabled: true, planKey: true, activatedAt: true, expiresAt: true } } } }),
    prisma.auditEvent.findMany({ where: { entityType: "Company", entityId: companyId, actionKey: { in: [...ENTITLEMENT_ACTIONS, "PROJECT_3D_ENTITLEMENT_CHANGED"] } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 30, select: { id: true, actionKey: true, actorDisplayNameSnapshot: true, occurredAt: true, reason: true, afterJson: true } }),
  ]);
  const switchedOn = new Map(switches.map((row) => [row.module.key, row.enabled]));
  const resolved = resolveCompany(sources.get(companyId) ?? null);
  return {
    company: { id: company.id, name: company.name, status: company.status, group: company.parentGroup.kind === "GROUP" ? { id: company.parentGroup.id, name: company.parentGroup.name } : null },
    version: company.entitlement?.version ?? 0,
    plan: company.entitlement === null ? { id: null, name: "Full NESTO" } : { id: company.entitlement.planId, name: company.entitlement.plan?.name ?? "Custom" },
    modules: resolved.map((item) => ({
      key: item.key, name: registry[item.key].label, description: registry[item.key].description,
      state: item.state as EntitlementState, entitled: item.entitled, inPlan: item.inPlan, source: item.source,
      override: item.override ? { mode: item.override.mode, startsAt: item.override.startsAt?.toISOString() ?? null, endsAt: item.override.endsAt?.toISOString() ?? null } : null,
      dependencies: (ENTITLEMENT_DEPENDENCIES[item.key] ?? []),
      switchedOn: item.source === "core" ? true : switchedOn.get(item.key) ?? false,
    })),
    limits: {
      maxActiveUsers: company.entitlement?.maxActiveUsers ?? null, maxProjects: company.entitlement?.maxProjects ?? null,
      maxStorageBytes: company.storageQuota?.maxStorageBytes === null || company.storageQuota?.maxStorageBytes === undefined ? null : Number(company.storageQuota.maxStorageBytes),
      users, projects: projects.length, storageBytes: Number(company.storageUsage?.usedBytes ?? 0),
    },
    projects: projects.map((row) => ({ id: row.id, name: row.name, code: row.code, status: row.status, viewer3d: row.project3DEntitlement ? { status: row.project3DEntitlement.status, viewerEnabled: row.project3DEntitlement.viewerEnabled, planKey: row.project3DEntitlement.planKey, activatedAt: row.project3DEntitlement.activatedAt?.toISOString() ?? null, expiresAt: row.project3DEntitlement.expiresAt?.toISOString() ?? null } : null })),
    history: history.map((row) => ({ id: row.id, actionKey: row.actionKey, actor: row.actorDisplayNameSnapshot, occurredAt: row.occurredAt.toISOString(), reason: row.reason, after: row.afterJson as Record<string, unknown> | null })),
  };
}

// ── Changing a company's entitlements (§17-§23, §27, §28, §62-§64) ─────────

export const entitlementChangeSchema = z.object({
  version: z.number().int().min(0),
  /** Absent: keep; null: Custom (overrides only); an id: that plan. */
  planId: z.string().trim().max(64).nullable().optional(),
  changes: z.array(z.object({
    moduleKey: z.enum(ENTITLABLE_MODULES as [ModuleKey, ...ModuleKey[]]),
    /** INHERIT removes the override, so the plan decides again. */
    mode: z.enum(["INHERIT", "ENABLED", "DISABLED", "TRIAL"]),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })).max(ENTITLABLE_MODULES.length),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
}).superRefine((input, ctx) => {
  for (const [index, change] of input.changes.entries()) {
    if (change.mode === "TRIAL" && !change.endsAt) ctx.addIssue({ code: "custom", path: ["changes", index, "endsAt"], message: "A trial needs an end date." });
    if (change.startsAt && change.endsAt && change.endsAt <= change.startsAt) ctx.addIssue({ code: "custom", path: ["changes", index, "endsAt"], message: "The end must come after the start." });
  }
});
export type EntitlementChangeInput = z.infer<typeof entitlementChangeSchema>;

function dependencyMessage(problems: Array<{ module: ModuleKey; needs: ModuleKey[] }>): string {
  return problems.map((problem) => `${moduleLabel(problem.module)} needs ${problem.needs.map(moduleLabel).join(" and ")}`).join("; ") + ". Grant those too, or remove the module that needs them.";
}

/** What a plan change would do, before it is applied (§27). */
export async function previewPlanChange(context: PlatformContext, companyId: string, planId: string | null) {
  assertPlatform(context, "platform.module.view");
  const sources = await loadEntitlementSources([companyId]);
  const current = sources.get(companyId) ?? null;
  const target = planId ? assertFound(await prisma.entitlementPlan.findUnique({ where: { id: planId }, select: { moduleKeys: true } })) : { moduleKeys: [] as string[] };
  const before = resolveCompany(current).filter((row) => row.entitled && row.source !== "core").map((row) => row.key);
  const after = resolveCompany({ planKeys: new Set(target.moduleKeys), overrides: current?.overrides ?? [] }).filter((row) => row.entitled && row.source !== "core").map((row) => row.key);
  return {
    disable: before.filter((key) => !after.includes(key)).map(moduleLabel),
    enable: after.filter((key) => !before.includes(key)).map(moduleLabel),
    keep: after.filter((key) => before.includes(key)).map(moduleLabel),
  };
}

/**
 * Applies a reviewed set of changes in one transaction (§62-§64): all of them
 * or none. Refused when another save got there first, or when the result
 * would grant a module without what it needs (§20). Suspension is not an
 * entitlement: a suspended company keeps its rows untouched (§68).
 */
export async function applyEntitlementChanges(context: PlatformContext, companyId: string, raw: unknown): Promise<{ version: number }> {
  assertPlatform(context, "platform.module.manage");
  const input = entitlementChangeSchema.parse(raw);
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, ...REAL_COMPANY }, select: { id: true, name: true, parentGroupId: true } }));

  return prisma.$transaction(async (tx) => {
    await ensureCompanyEntitlement(tx, companyId);
    const current = assertFound(await tx.companyEntitlement.findUnique({ where: { companyId }, select: { version: true, planId: true, plan: { select: { name: true } } } }));
    if (current.version !== input.version) throw new AccessError("CONFLICT", "These entitlements changed since you opened them. Reload and review again.", { code: "STALE_ENTITLEMENTS" });
    const before = resolveCompany((await loadEntitlementSources([companyId], tx)).get(companyId) ?? null);

    let planName = current.plan?.name ?? "Custom";
    if (input.planId !== undefined && input.planId !== current.planId) {
      const plan = input.planId ? assertFound(await tx.entitlementPlan.findFirst({ where: { id: input.planId, status: "ACTIVE" }, select: { id: true, name: true, maxActiveUsers: true, maxProjects: true, maxStorageBytes: true } })) : null;
      // A new plan brings its limits with it; they can be adjusted afterwards (§47, §50).
      await tx.companyEntitlement.update({ where: { companyId }, data: { planId: plan?.id ?? null, ...(plan ? { maxActiveUsers: plan.maxActiveUsers, maxProjects: plan.maxProjects } : {}) } });
      if (plan) await tx.companyStorageQuota.updateMany({ where: { companyId }, data: { maxStorageBytes: plan.maxStorageBytes } });
      planName = plan?.name ?? "Custom";
    }
    for (const change of input.changes) {
      if (change.mode === "INHERIT") {
        await tx.companyModuleEntitlement.deleteMany({ where: { companyId, moduleKey: change.moduleKey } });
        continue;
      }
      const data = { mode: change.mode, startsAt: change.startsAt ?? null, endsAt: change.mode === "DISABLED" ? null : change.endsAt ?? null, note: input.reason || null, updatedByUserId: context.userId };
      await tx.companyModuleEntitlement.upsert({ where: { companyId_moduleKey: { companyId, moduleKey: change.moduleKey } }, update: data, create: { companyId, moduleKey: change.moduleKey, ...data } });
    }

    const after = resolveCompany((await loadEntitlementSources([companyId], tx)).get(companyId) ?? null);
    const problems = missingDependencies(new Set(after.filter((row) => row.entitled).map((row) => row.key)));
    if (problems.length) throw new AccessError("VALIDATION_ERROR", dependencyMessage(problems), { code: "MODULE_DEPENDENCY_BLOCKED" });

    const updated = await tx.companyEntitlement.update({ where: { companyId }, data: { version: { increment: 1 }, updatedByUserId: context.userId }, select: { version: true } });
    // Every cached reading of the company's modules is now stale (§82).
    await tx.company.update({ where: { id: companyId }, data: { configVersion: { increment: 1 } } });

    const state = (rows: typeof before) => rows.filter((row) => row.source !== "core").map((row) => `${row.key}:${row.state}`).join(", ");
    const changed = after.filter((row, index) => row.state !== before[index].state).map((row) => `${moduleLabel(row.key)}: ${before.find((item) => item.key === row.key)?.state} → ${row.state}`);
    await recordPlatformAction(context, company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_ENTITLEMENTS_CHANGED,
      entity: { type: "Company", id: companyId, label: company.name },
      before: { plan: current.plan?.name ?? "Custom", modules: state(before) },
      after: { plan: planName, modules: state(after), changed: changed.join("; ") || "No module changed" },
      reason: input.reason || undefined,
    }, { tx });
    return { version: updated.version };
  });
}

export const limitsSchema = z.object({
  maxActiveUsers: limit(z.number().int().min(1).max(1_000_000)),
  maxProjects: limit(z.number().int().min(1).max(1_000_000)),
  maxStorageGb: limit(z.number().min(1).max(1_000_000)),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Adjusts a company's limits; empty means unlimited (§48, §50). */
export async function setCompanyLimits(context: PlatformContext, companyId: string, raw: unknown): Promise<void> {
  assertPlatform(context, "platform.module.manage");
  const input = limitsSchema.parse(raw);
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, ...REAL_COMPANY }, select: { id: true, name: true, parentGroupId: true } }));
  await prisma.$transaction(async (tx) => {
    await ensureCompanyEntitlement(tx, companyId);
    const before = await tx.companyEntitlement.findUniqueOrThrow({ where: { companyId }, select: { maxActiveUsers: true, maxProjects: true } });
    const quota = await tx.companyStorageQuota.findUnique({ where: { companyId }, select: { maxStorageBytes: true } });
    const storage = input.maxStorageGb === null ? null : BigInt(Math.round(input.maxStorageGb * 1024 ** 3));
    await tx.companyEntitlement.update({ where: { companyId }, data: { maxActiveUsers: input.maxActiveUsers, maxProjects: input.maxProjects, version: { increment: 1 }, updatedByUserId: context.userId } });
    await tx.companyStorageQuota.updateMany({ where: { companyId }, data: { maxStorageBytes: storage } });
    const gb = (value: bigint | null | undefined) => (value === null || value === undefined ? "Unlimited" : `${Number(value) / 1024 ** 3} GB`);
    await recordPlatformAction(context, company.parentGroupId, {
      actionKey: AuditAction.PLATFORM_ENTITLEMENT_LIMITS_CHANGED,
      entity: { type: "Company", id: companyId, label: company.name },
      before: { maxActiveUsers: before.maxActiveUsers ?? "Unlimited", maxProjects: before.maxProjects ?? "Unlimited", maxStorage: gb(quota?.maxStorageBytes) },
      after: { maxActiveUsers: input.maxActiveUsers ?? "Unlimited", maxProjects: input.maxProjects ?? "Unlimited", maxStorage: gb(storage) },
      reason: input.reason || undefined,
    }, { tx });
  });
}
