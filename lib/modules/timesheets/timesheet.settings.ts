import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";
import type { TimesheetSettingsInput } from "./timesheet.schema";
import type { TimesheetSettingsDTO } from "./timesheet.types";

/**
 * Company timesheet rules (PRD #42 §12, §28-§35, §59, §101, §217, §218).
 *
 * Created on first read with the PRD's defaults: weeks start Monday, a
 * standard 8-hour day and 40-hour week, 15-minute steps, two weeks of
 * backdating, no submission deadline. The company's time zone comes from its
 * general settings, which are authoritative (§20).
 */

export async function resolveTimesheetSettings(companyId: string): Promise<TimesheetSettingsDTO> {
  const [row, company] = await Promise.all([
    prisma.timesheetSettings.upsert({ where: { companyId }, update: {}, create: { companyId } }),
    ensureCompanySettings(companyId),
  ]);
  return {
    weekStartsOn: row.weekStartsOn,
    standardDailyMinutes: row.standardDailyMinutes,
    standardWeeklyMinutes: row.standardWeeklyMinutes,
    incrementMinutes: row.incrementMinutes,
    enforceIncrement: row.enforceIncrement,
    backdateDays: row.backdateDays,
    submitDay: row.submitDay,
    submitTime: row.submitTime,
    descriptionsRequired: row.descriptionsRequired,
    membersSetBillable: row.membersSetBillable,
    timezone: company.timezone,
  };
}

export async function getTimesheetSettings(context: UserContext): Promise<TimesheetSettingsDTO> {
  assertModule(context, "timesheets");
  return resolveTimesheetSettings(context.companyId);
}

export async function updateTimesheetSettings(context: UserContext, input: TimesheetSettingsInput): Promise<TimesheetSettingsDTO> {
  assertModule(context, "timesheets");
  assertPermission(context, "timesheet.settings.manage");
  if (input.standardWeeklyMinutes < input.standardDailyMinutes) {
    throw new AccessError("VALIDATION_ERROR", "The standard week cannot be shorter than a standard day.", { standardWeeklyMinutes: ["The standard week cannot be shorter than a standard day."] });
  }
  const before = await resolveTimesheetSettings(context.companyId);
  await prisma.$transaction(async (tx) => {
    await tx.timesheetSettings.update({ where: { companyId: context.companyId }, data: { ...input, updatedByMemberId: context.membershipId } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.TIMESHEET_SETTINGS_UPDATED,
        entity: { type: "TimesheetSettings", id: context.companyId, label: "Timesheet settings" },
        before: { ...before },
        after: { ...input },
      },
      { tx },
    );
  });
  return resolveTimesheetSettings(context.companyId);
}
