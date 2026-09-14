import type { z } from "zod";

import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { MODULE } from "./planning.permissions";
import type { planningSettingsSchema } from "./planning.schema";
import type { PlanningSettingsDTO } from "./planning.types";

/**
 * Company planning rules (PRD #44 §71, §165, §253, §309). Created on first
 * read with the PRD's defaults: due-soon reminders seven days ahead, a reason
 * for every baseline change, and executives left out of milestone notices.
 */

export async function resolvePlanningSettings(companyId: string): Promise<PlanningSettingsDTO> {
  const [row, company] = await Promise.all([
    prisma.projectPlanningSettings.upsert({ where: { companyId }, update: {}, create: { companyId } }),
    ensureCompanySettings(companyId),
  ]);
  return {
    milestoneReminderDays: row.milestoneReminderDays,
    baselineChangeReasonRequired: row.baselineChangeReasonRequired,
    notifyExecutivesOnCriticalChanges: row.notifyExecutivesOnCriticalChanges,
    timezone: company.timezone,
  };
}

export async function updatePlanningSettings(context: UserContext, input: z.infer<typeof planningSettingsSchema>): Promise<PlanningSettingsDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "project_planning.settings.manage");
  const before = await resolvePlanningSettings(context.companyId);
  await prisma.$transaction(async (tx) => {
    await tx.projectPlanningSettings.update({ where: { companyId: context.companyId }, data: { ...input, updatedByMemberId: context.membershipId } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_PLANNING_SETTINGS_UPDATED,
        entity: { type: "company", id: context.companyId, label: "Planning settings" },
        before: { milestoneReminderDays: before.milestoneReminderDays, baselineChangeReasonRequired: before.baselineChangeReasonRequired, notifyExecutivesOnCriticalChanges: before.notifyExecutivesOnCriticalChanges },
        after: input,
      },
      { tx },
    );
  });
  return resolvePlanningSettings(context.companyId);
}
