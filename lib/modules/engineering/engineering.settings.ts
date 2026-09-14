import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { MODULE } from "./engineering.permissions";
import type { EngineeringSettingsInput } from "./engineering.schema";

/**
 * Company defaults for contractor and engineering work (PRD #46 §279). Created
 * on first read: RFIs due in seven days, submittal reviews in fourteen,
 * compliance reminders thirty days before expiry, due-soon notices two days
 * ahead, and nobody reviewing their own submission.
 *
 * Switching contractors or engineering off is the company's module switch
 * (Settings → Modules), not a second flag here.
 */

export type EngineeringSettingsDTO = EngineeringSettingsInput & { timezone: string };

export async function resolveEngineeringSettings(companyId: string): Promise<EngineeringSettingsDTO> {
  const [row, company] = await Promise.all([
    prisma.engineeringSettings.upsert({ where: { companyId }, update: {}, create: { companyId } }),
    ensureCompanySettings(companyId),
  ]);
  return {
    rfiDefaultDueDays: row.rfiDefaultDueDays,
    submittalDefaultReviewDays: row.submittalDefaultReviewDays,
    contractorComplianceReminderDays: row.contractorComplianceReminderDays,
    dueSoonDays: row.dueSoonDays,
    allowSelfReview: row.allowSelfReview,
    requireSubmittalDueDate: row.requireSubmittalDueDate,
    timezone: company.timezone,
  };
}

export async function companyToday(companyId: string): Promise<{ settings: EngineeringSettingsDTO; today: string }> {
  const settings = await resolveEngineeringSettings(companyId);
  return { settings, today: localDate(new Date(), settings.timezone) };
}

export async function updateEngineeringSettings(context: UserContext, input: EngineeringSettingsInput): Promise<EngineeringSettingsDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "engineering.settings.manage");
  const before = await resolveEngineeringSettings(context.companyId);
  await prisma.$transaction(async (tx) => {
    await tx.engineeringSettings.update({ where: { companyId: context.companyId }, data: { ...input, updatedByMemberId: context.membershipId } });
    const previous = { rfiDefaultDueDays: before.rfiDefaultDueDays, submittalDefaultReviewDays: before.submittalDefaultReviewDays, contractorComplianceReminderDays: before.contractorComplianceReminderDays, dueSoonDays: before.dueSoonDays, allowSelfReview: before.allowSelfReview, requireSubmittalDueDate: before.requireSubmittalDueDate };
    await recordUserAction(context, { actionKey: AuditAction.ENGINEERING_SETTINGS_UPDATED, entity: { type: "company", id: context.companyId, label: "Engineering settings" }, before: previous, after: input }, { tx });
  });
  return resolveEngineeringSettings(context.companyId);
}
