import { z } from "zod";

import { assertPermission } from "@/lib/access/guards";
import { CORE_MODULE_KEYS, MODULE_KEYS, modules as registry, type ModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
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

async function enabledMap(companyId: string): Promise<Map<string, boolean>> {
  const rows = await prisma.companyModule.findMany({
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
  const settings = await prisma.companyIntegrationSettings.findUnique({ where: { companyId } });
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

export async function setModuleEnabled(
  context: UserContext,
  key: ModuleKey,
  enabled: boolean,
): Promise<CompanyModuleDTO[]> {
  assertPermission(context, "company.modules.manage");

  const current = await enabledMap(context.companyId);

  if (!enabled) {
    const blockers = await disableBlockers(context.companyId, key, current);
    if (blockers.length > 0) throw new Error(blockers[0].code);
  } else {
    // Enabling a module whose own dependencies are off would produce a module
    // that cannot function (PRD #24 §55).
    const missing = (DEPENDENCIES[key] ?? []).filter((dep) => !current.get(dep));
    if (missing.length > 0) throw new Error("MODULE_DEPENDENCY_BLOCKED");
  }

  const moduleRow = await prisma.module.findUnique({ where: { key } });
  if (!moduleRow) throw new Error("MODULE_NOT_FOUND");

  const was = current.get(key) ?? false;

  await prisma.$transaction(async (tx) => {
    await tx.companyModule.upsert({
      where: { companyId_moduleId: { companyId: context.companyId, moduleId: moduleRow.id } },
      update: { enabled },
      create: { companyId: context.companyId, moduleId: moduleRow.id, enabled },
    });

    // Nothing may keep serving a disabled module from a stale cache
    // (PRD #24 §165, §321).
    await tx.company.update({
      where: { id: context.companyId },
      data: { configVersion: { increment: 1 } },
    });

    // Turning a department module off is a CRITICAL configuration change, and
    // the policy is required — so it commits with the toggle or not at all
    // (PRD #28 §99, §136).
    await recordUserAction(
      context,
      {
        actionKey: enabled ? AuditAction.COMPANY_MODULE_ENABLED : AuditAction.COMPANY_MODULE_DISABLED,
        entity: { type: "company_module", id: key, label: registry[key].label },
        before: { moduleKey: key, enabled: was },
        after: { moduleKey: key, enabled },
      },
      { tx },
    );
  });

  return listCompanyModules(context);
}

export { CORE_MODULES, SHARED_MODULES, DEPENDENCIES, integrationBlockers };
