import type { ModuleEntitlementMode, Prisma } from "@prisma/client";

import { CORE_MODULE_KEYS, MODULE_KEYS, modules as registry, type ModuleKey } from "@/config/modules";
import { prisma } from "@/lib/database/prisma";

/**
 * The one answer to "may this company use this module?" (Admin Modules PRD #4
 * §29, §30). Plan default, then the company's override, then its dates: the
 * sidebar, route guards and APIs all read it through the member context, so
 * nothing re-derives it. It never grants a person anything — a user still
 * needs the permission (§31).
 */

/** Core NESTO: always granted, never a switch (§39). */
export const REQUIRED_MODULES: readonly ModuleKey[] = CORE_MODULE_KEYS;

/** Modules a plan or an override can grant. */
export const ENTITLABLE_MODULES: readonly ModuleKey[] = MODULE_KEYS.filter((key) => !(CORE_MODULE_KEYS as readonly string[]).includes(key));

/**
 * What a module needs granted beside it (§6, §20), in one place. The company's
 * own switches have their own, narrower list in module-toggle.service.
 */
export const ENTITLEMENT_DEPENDENCIES: Partial<Record<ModuleKey, ModuleKey[]>> = {
  tasks: ["projects"],
  meetings: ["projects"],
  timesheets: ["projects"],
  dailyLogs: ["projects"],
  engineering: ["projects", "documents"],
  contractors: ["projects"],
  sales: ["clients", "projects"],
  contracts: ["clients"],
  procurement: ["projects"],
  inventory: ["procurement"],
  qaqc: ["projects"],
  hse: ["projects"],
};

export type EntitlementState = "Required" | "Enabled" | "Disabled" | "Trial" | "Scheduled" | "Expired";

export type OverrideRow = { moduleKey: string; mode: ModuleEntitlementMode; startsAt: Date | null; endsAt: Date | null };

export type ModuleResolution = {
  key: ModuleKey;
  state: EntitlementState;
  entitled: boolean;
  source: "core" | "plan" | "override";
  inPlan: boolean;
  override: OverrideRow | null;
};

/** One module, from the plan's list and the override, at `now`. Pure. */
export function resolveModule(key: ModuleKey, planKeys: ReadonlySet<string>, override: OverrideRow | null, now: Date): ModuleResolution {
  const inPlan = planKeys.has(key);
  if ((REQUIRED_MODULES as readonly string[]).includes(key)) return { key, state: "Required", entitled: true, source: "core", inPlan: true, override: null };
  if (!override) return { key, state: inPlan ? "Enabled" : "Disabled", entitled: inPlan, source: "plan", inPlan, override: null };
  const started = !override.startsAt || override.startsAt <= now;
  const ended = Boolean(override.endsAt && override.endsAt <= now);
  if (override.mode === "DISABLED") return { key, state: "Disabled", entitled: false, source: "override", inPlan, override };
  if (!started) return { key, state: "Scheduled", entitled: false, source: "override", inPlan, override };
  if (ended) return { key, state: override.mode === "TRIAL" ? "Expired" : "Disabled", entitled: false, source: "override", inPlan, override };
  return { key, state: override.mode === "TRIAL" ? "Trial" : "Enabled", entitled: true, source: "override", inPlan, override };
}

export type CompanyEntitlementSource = { planKeys: ReadonlySet<string>; overrides: OverrideRow[] };

/** Every module of one company. A company with no entitlement row holds everything (§86): the migration gave each one Full NESTO. */
export function resolveCompany(source: CompanyEntitlementSource | null, now: Date = new Date()): ModuleResolution[] {
  const planKeys = source?.planKeys ?? new Set<string>(ENTITLABLE_MODULES);
  const byKey = new Map((source?.overrides ?? []).map((row) => [row.moduleKey, row]));
  return MODULE_KEYS.map((key) => resolveModule(key, planKeys, byKey.get(key) ?? null, now));
}

type Db = Prisma.TransactionClient | typeof prisma;

/** The entitlement sources of several companies, in two queries. */
export async function loadEntitlementSources(companyIds: readonly string[], db: Db = prisma): Promise<Map<string, CompanyEntitlementSource | null>> {
  const rows = companyIds.length
    ? await db.companyEntitlement.findMany({
        where: { companyId: { in: [...companyIds] } },
        select: { companyId: true, plan: { select: { moduleKeys: true } }, overrides: { select: { moduleKey: true, mode: true, startsAt: true, endsAt: true } } },
      })
    : [];
  const byCompany = new Map(rows.map((row) => [row.companyId, { planKeys: new Set(row.plan?.moduleKeys ?? []), overrides: row.overrides }]));
  return new Map(companyIds.map((companyId) => [companyId, byCompany.get(companyId) ?? null]));
}

/** The modules each company is entitled to right now. */
export async function entitledModulesFor(companyIds: readonly string[], db: Db = prisma, now: Date = new Date()): Promise<Map<string, Set<ModuleKey>>> {
  const sources = await loadEntitlementSources(companyIds, db);
  return new Map([...sources].map(([companyId, source]) => [companyId, new Set(resolveCompany(source, now).filter((row) => row.entitled).map((row) => row.key))]));
}

/** Modules granted without what they need granted beside them (§6, §20). */
export function missingDependencies(entitled: ReadonlySet<ModuleKey>): Array<{ module: ModuleKey; needs: ModuleKey[] }> {
  const problems: Array<{ module: ModuleKey; needs: ModuleKey[] }> = [];
  for (const key of entitled) {
    const needs = (ENTITLEMENT_DEPENDENCIES[key] ?? []).filter((dependency) => !entitled.has(dependency) && !(REQUIRED_MODULES as readonly string[]).includes(dependency));
    if (needs.length) problems.push({ module: key, needs });
  }
  return problems;
}

export function moduleLabel(key: string): string {
  return registry[key as ModuleKey]?.label ?? key;
}
