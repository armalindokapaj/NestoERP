import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { AccessError, assertPermission } from "@/lib/access/guards";
import { CORE_MODULE_KEYS, MODULE_KEYS, modules as registry, type ModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { invalidateRequestScope } from "@/lib/core/observability/request-scope";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { integrationBlockers } from "./integration-settings.service";

/**
 * Module activation (PRD #24 §50-§70, PRD #37 §31).
 *
 * CompanyModule is authoritative: navigation, routes and APIs all read it, so
 * disabling a module has to stop the API too, not merely hide a link
 * (PRD #24 §168). Disabling never deletes anything — the records stay and come
 * back intact when the module is re-enabled (PRD #24 §60, §61).
 */

/** Core modules are the product itself and cannot be switched off (PRD #24 §47, §175). */
const CORE_MODULES: ModuleKey[] = [...CORE_MODULE_KEYS];

/** Shared work modules other modules reference constantly (PRD #24 §48, §173). */
const SHARED_MODULES: ModuleKey[] = ["projects", "tasks", "clients", "documents"];

/** Declared dependencies (PRD #24 §170). */
const DEPENDENCIES: Partial<Record<ModuleKey, ModuleKey[]>> = {
  hr: ["team"],
  sales: ["clients"],
  contracts: ["clients"],
};

export const moduleToggleSchema = z.object({ enabled: z.boolean() });

export type ModuleBlocker = { code: string; message: string };

export type CompanyModuleDTO = {
  key: ModuleKey;
  name: string;
  description: string;
  enabled: boolean;
  requiredCore: boolean;
  dependencies: Array<{ moduleKey: ModuleKey; enabled: boolean }>;
  blockers: ModuleBlocker[];
  canManage: boolean;
};

type Db = Prisma.TransactionClient | typeof prisma;

async function enabledMap(companyId: string, db: Db = prisma): Promise<Map<string, boolean>> {
  const rows = await db.companyModule.findMany({
    where: { companyId },
    select: { enabled: true, module: { select: { key: true } } },
  });
  return new Map(rows.map((r) => [r.module.key, r.enabled]));
}

/**
 * Why a module cannot be turned off right now. Reported rather than thrown so
 * the card can explain itself before anyone clicks (PRD #24 §66, §178, §225).
 */
async function disableBlockers(
  companyId: string,
  key: ModuleKey,
  enabled: Map<string, boolean>,
  db: Db = prisma,
): Promise<ModuleBlocker[]> {
  const blockers: ModuleBlocker[] = [];

  if (CORE_MODULES.includes(key)) {
    blockers.push({ code: "CORE_MODULE_REQUIRED", message: `${registry[key].label} is part of the product and cannot be disabled.` });
    return blockers;
  }

  if (SHARED_MODULES.includes(key)) {
    blockers.push({
      code: "MODULE_DEPENDENCY_BLOCKED",
      message: `${registry[key].label} is shared by every other module and stays enabled in V0.1.`,
    });
    return blockers;
  }

  // A module another enabled module declares a dependency on stays on.
  const dependants = (Object.entries(DEPENDENCIES) as Array<[ModuleKey, ModuleKey[]]>)
    .filter(([dependant, deps]) => deps.includes(key) && enabled.get(dependant))
    .map(([dependant]) => registry[dependant].label);
  if (dependants.length > 0) {
    blockers.push({
      code: "MODULE_DEPENDENCY_BLOCKED",
      message: `${dependants.join(", ")} depends on ${registry[key].label}. Disable it first.`,
    });
  }

  // An integration still switched on keeps its modules alive (PRD #24 §58, §59).
  const settings = await db.companyIntegrationSettings.findUnique({ where: { companyId } });
  if (settings?.qualityGateForInventoryReceipts && ["procurement", "inventory", "qaqc"].includes(key)) {
    blockers.push({
      code: "INTEGRATION_DEPENDENCY_BLOCKED",
      message: `Inventory quality gating is on and needs ${registry[key].label}. Turn the gate off first.`,
    });
  }
  if (settings?.autoCreateFinanceCommitmentFromApprovedPo && ["procurement", "finance"].includes(key)) {
    blockers.push({
      code: "INTEGRATION_DEPENDENCY_BLOCKED",
      message: `Automatic finance commitments are on and need ${registry[key].label}. Turn that off first.`,
    });
  }

  return blockers;
}

export async function listCompanyModules(context: UserContext): Promise<CompanyModuleDTO[]> {
  assertPermission(context, "company.modules.view");
  const canManage = context.permissions.includes("company.modules.manage");
  const enabled = await enabledMap(context.companyId);

  return Promise.all(
    MODULE_KEYS.map(async (key) => ({
      key,
      name: registry[key].label,
      description: registry[key].description,
      enabled: enabled.get(key) ?? false,
      requiredCore: CORE_MODULES.includes(key),
      dependencies: (DEPENDENCIES[key] ?? []).map((dep) => ({
        moduleKey: dep,
        enabled: enabled.get(dep) ?? false,
      })),
      blockers: await disableBlockers(context.companyId, key, enabled),
      canManage,
    })),
  );
}

/** Why a module cannot be switched on right now (PRD #24 §55). */
function enableBlockers(key: ModuleKey, enabled: Map<string, boolean>): ModuleBlocker[] {
  const missing = (DEPENDENCIES[key] ?? []).filter((dep) => !enabled.get(dep));
  if (missing.length === 0) return [];
  return [{ code: "MODULE_DEPENDENCY_BLOCKED", message: `Enable ${missing.map((dep) => registry[dep].label).join(", ")} first.` }];
}

/** A change the module policy refuses; `message` is the code, as callers have always matched on. */
export class ModulePolicyError extends Error {
  constructor(readonly blocker: ModuleBlocker) {
    super(blocker.code);
  }
}

/**
 * The one module policy both entry points go through — company Settings and
 * the Platform console (ADM audit §2). Blockers are computed inside the
 * transaction from the state it will write over, and the write is guarded by
 * the company's configVersion, which every module and integration change
 * bumps: a competing change in between refuses this one instead of leaving a
 * combination neither check allowed.
 */
export async function applyModuleChange(
  companyId: string,
  key: ModuleKey,
  enabled: boolean,
  audit: (tx: Prisma.TransactionClient, was: boolean) => Promise<void>,
): Promise<{ changed: boolean }> {
  const moduleRow = await prisma.module.findUnique({ where: { key }, select: { id: true } });
  if (!moduleRow) throw new ModulePolicyError({ code: "MODULE_NOT_FOUND", message: "That module does not exist." });

  return prisma.$transaction(async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { configVersion: true } });
    const current = await enabledMap(companyId, tx);
    const blockers = enabled ? enableBlockers(key, current) : await disableBlockers(companyId, key, current, tx);
    if (blockers.length > 0) throw new ModulePolicyError(blockers[0]);

    const was = current.get(key) ?? false;
    if (was === enabled) return { changed: false };

    // Nothing may keep serving a disabled module from a stale cache
    // (PRD #24 §165, §321) — and the bump is the concurrency guard.
    const bumped = await tx.company.updateMany({
      where: { id: companyId, configVersion: company.configVersion },
      data: { configVersion: { increment: 1 } },
    });
    if (bumped.count !== 1) throw new AccessError("CONFLICT", "The company's modules changed while this was being saved. Refresh and try again.");

    await tx.companyModule.upsert({
      where: { companyId_moduleId: { companyId, moduleId: moduleRow.id } },
      update: { enabled },
      create: { companyId, moduleId: moduleRow.id, enabled },
    });
    // The audit record is required, so it commits with the toggle or not at all (PRD #28 §99, §136).
    await audit(tx, was);
    return { changed: true };
  });
}

export async function setModuleEnabled(
  context: UserContext,
  key: ModuleKey,
  enabled: boolean,
): Promise<CompanyModuleDTO[]> {
  assertPermission(context, "company.modules.manage");

  await applyModuleChange(context.companyId, key, enabled, (tx, was) =>
    recordUserAction(
      context,
      {
        actionKey: enabled ? AuditAction.COMPANY_MODULE_ENABLED : AuditAction.COMPANY_MODULE_DISABLED,
        entity: { type: "company_module", id: key, label: registry[key].label },
        before: { moduleKey: key, enabled: was },
        after: { moduleKey: key, enabled },
      },
      { tx },
    ).then(() => undefined),
  );
  // This request's module snapshot predates the toggle (NAV-02 CTX-04).
  invalidateRequestScope();

  return listCompanyModules(context);
}

export { CORE_MODULES, SHARED_MODULES, DEPENDENCIES, integrationBlockers };
