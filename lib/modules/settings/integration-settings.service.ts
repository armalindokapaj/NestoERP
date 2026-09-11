import { z } from "zod";

import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";

/**
 * Cross-module integration toggles (PRD #24 §71-§85, PRD #37 §116).
 *
 * Each flag switches on one implemented, product-defined handoff. This is not a
 * workflow builder (PRD #23 §199), and a toggle never rewrites history: turning
 * the commitment integration off affects future approvals only, and existing
 * commitments stay exactly as they are (PRD #24 §83, §84).
 */

export const integrationSettingsSchema = z.object({
  qualityGateForInventoryReceipts: z.boolean(),
  autoCreateFinanceCommitmentFromApprovedPo: z.boolean(),
});

export type IntegrationSettingsInput = z.infer<typeof integrationSettingsSchema>;

export type IntegrationBlocker = { key: string; message: string };

export type IntegrationSettingsDTO = IntegrationSettingsInput & {
  capabilities: { canUpdate: boolean };
  blockers: IntegrationBlocker[];
};

export async function ensureIntegrationSettings(companyId: string) {
  return prisma.companyIntegrationSettings.upsert({
    where: { companyId },
    create: { companyId },
    update: {},
  });
}

async function enabledModuleKeys(companyId: string): Promise<Set<string>> {
  const rows = await prisma.companyModule.findMany({
    where: { companyId, enabled: true },
    select: { module: { select: { key: true } } },
  });
  return new Set(rows.map((r) => r.module.key));
}

/**
 * A toggle may only be switched on when every module it depends on is enabled
 * (PRD #24 §77, §82). Reported rather than thrown, so the UI can explain why a
 * switch is unavailable instead of failing on submit (PRD #24 §225).
 */
export async function integrationBlockers(companyId: string): Promise<IntegrationBlocker[]> {
  const enabled = await enabledModuleKeys(companyId);
  const blockers: IntegrationBlocker[] = [];

  const missingForGate = ["procurement", "inventory", "qaqc"].filter((k) => !enabled.has(k));
  if (missingForGate.length > 0) {
    blockers.push({
      key: "qualityGateForInventoryReceipts",
      message: `Quality gating needs ${missingForGate.join(", ")} enabled.`,
    });
  }

  const missingForCommitment = ["procurement", "finance"].filter((k) => !enabled.has(k));
  if (missingForCommitment.length > 0) {
    blockers.push({
      key: "autoCreateFinanceCommitmentFromApprovedPo",
      message: `Finance commitments need ${missingForCommitment.join(", ")} enabled.`,
    });
  }

  return blockers;
}

export async function getIntegrationSettings(context: UserContext): Promise<IntegrationSettingsDTO> {
  assertPermission(context, "company.integrations.view");
  const [row, blockers] = await Promise.all([
    ensureIntegrationSettings(context.companyId),
    integrationBlockers(context.companyId),
  ]);
  return {
    qualityGateForInventoryReceipts: row.qualityGateForInventoryReceipts,
    autoCreateFinanceCommitmentFromApprovedPo: row.autoCreateFinanceCommitmentFromApprovedPo,
    capabilities: {
      canUpdate: context.permissions.includes("company.integrations.manage"),
    },
    blockers,
  };
}

export async function updateIntegrationSettings(
  context: UserContext,
  input: IntegrationSettingsInput,
): Promise<IntegrationSettingsDTO> {
  assertPermission(context, "company.integrations.manage");

  const blockers = await integrationBlockers(context.companyId);
  const current = await ensureIntegrationSettings(context.companyId);

  for (const [key, value] of Object.entries(input) as Array<[keyof IntegrationSettingsInput, boolean]>) {
    const turningOn = value && !current[key];
    if (turningOn && blockers.some((b) => b.key === key)) {
      throw new Error("INTEGRATION_DEPENDENCY_BLOCKED");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.companyIntegrationSettings.update({
      where: { companyId: context.companyId },
      data: { ...input, updatedByMemberId: context.membershipId },
    });
    await tx.company.update({
      where: { id: context.companyId },
      data: { configVersion: { increment: 1 } },
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.COMPANY_INTEGRATION_SETTING_CHANGED,
        entity: { type: "company_integration_settings", id: context.companyId },
        before: {
          qualityGateForInventoryReceipts: current.qualityGateForInventoryReceipts,
          autoCreateFinanceCommitmentFromApprovedPo: current.autoCreateFinanceCommitmentFromApprovedPo,
        },
        after: input,
      },
      { tx },
    );
  });

  return getIntegrationSettings(context);
}
