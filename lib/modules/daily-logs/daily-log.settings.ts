import type { z } from "zod";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { ensureCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { dailyLogsOpen, MODULE, projectDoor } from "./daily-log.permissions";
import type { projectSettingsSchema, settingsSchema } from "./daily-log.schema";
import type { DailyLogSettingsDTO } from "./daily-log.types";

/**
 * Daily log rules (PRD #43 §18, §89, §104-§106, §248-§250).
 *
 * The company decides whether active projects need a log for every working
 * day, how far back a log may be started, and whether a reviewer is required;
 * a project may require logs on its own, name its own reviewer and keep its
 * own working days. Created on first read with the PRD's defaults: not
 * required, seven days of backdating, a reviewer required.
 */

export async function resolveDailyLogSettings(companyId: string, projectId?: string | null): Promise<DailyLogSettingsDTO & { reviewerMemberId: string | null; projectRequired: boolean | null }> {
  const [row, company, project] = await Promise.all([
    prisma.dailyLogSettings.upsert({ where: { companyId }, update: {}, create: { companyId } }),
    ensureCompanySettings(companyId),
    projectId ? prisma.projectDailyLogSettings.findFirst({ where: { companyId, projectId } }) : Promise.resolve(null),
  ]);
  const rules = projectRules({ logsRequired: row.logsRequired, workingDays: company.workingDays?.length ? company.workingDays : [1, 2, 3, 4, 5] }, project);
  return {
    logsRequired: rules.logsRequired,
    projectRequired: project?.logsRequired ?? null,
    backdateDays: row.backdateDays,
    reviewerRequired: row.reviewerRequired,
    timezone: company.timezone,
    workingDays: rules.workingDays,
    reviewerMemberId: project?.reviewerMemberId ?? null,
  };
}

/**
 * A project's own rules over its company's (§89, §248): whether it needs logs,
 * when it said so, and its working days, when it named any. Pure, so a job
 * walking every project resolves the company once and applies this to each.
 */
export function projectRules(
  company: { logsRequired: boolean; workingDays: number[] },
  project: { logsRequired: boolean | null; workingDays: number[] } | null,
): { logsRequired: boolean; workingDays: number[] } {
  return { logsRequired: project?.logsRequired ?? company.logsRequired, workingDays: project?.workingDays.length ? project.workingDays : company.workingDays };
}

export async function updateDailyLogSettings(context: UserContext, input: z.infer<typeof settingsSchema>): Promise<DailyLogSettingsDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "daily_log.settings.manage");
  const before = await resolveDailyLogSettings(context.companyId);
  await prisma.$transaction(async (tx) => {
    await tx.dailyLogSettings.update({ where: { companyId: context.companyId }, data: { ...input, updatedByMemberId: context.membershipId } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.DAILY_LOG_SETTINGS_UPDATED,
        entity: { type: "DailyLogSettings", id: context.companyId, label: "Daily log settings" },
        before: { logsRequired: before.logsRequired, backdateDays: before.backdateDays, reviewerRequired: before.reviewerRequired },
        after: { ...input },
      },
      { tx },
    );
  });
  return resolveDailyLogSettings(context.companyId);
}

/**
 * Whether a member could review this project's logs (§88, §89, §233): the same
 * test `resolveReviewer` applies when a log is submitted — an active member of
 * this company, with daily logs open and the review grant, who can open the
 * project. A name the submission would skip is refused here rather than
 * saved and silently ignored.
 */
async function canReviewProjectLogs(companyId: string, projectId: string, memberId: string): Promise<boolean> {
  const memberContext = (await buildMemberContexts(companyId, [memberId])).get(memberId);
  if (!memberContext || !dailyLogsOpen(memberContext) || !can(memberContext, "daily_log.review")) return false;
  const door = projectDoor(memberContext);
  return door ? (await prisma.project.count({ where: { AND: [door, { id: projectId, companyId }] } })) > 0 : false;
}

/**
 * A project's own rules: the project manager's, or whoever manages daily log
 * settings (§89, §248).
 *
 * The project is read through the daily logs door before any permission is
 * decided (PRD #47 §47, §60): a project the writer cannot open answers like
 * one that does not exist, and a project-scoped grant reaches only the
 * projects in that scope. An archived project's rules are history (§273).
 */
export async function updateProjectDailyLogSettings(context: UserContext, projectId: string, input: z.infer<typeof projectSettingsSchema>) {
  assertModule(context, MODULE);
  const door = dailyLogsOpen(context) ? projectDoor(context) : null;
  const project = door ? await prisma.project.findFirst({ where: { AND: [door, { id: projectId, companyId: context.companyId }] }, select: { id: true, status: true, archivedAt: true, projectManagerMemberId: true } }) : null;
  if (!project) throw new AccessError("NOT_FOUND", "That project could not be found.", { code: "DAILY_LOG_PROJECT_NOT_FOUND" });
  const allowed = can(context, "daily_log.settings.manage") || (project.projectManagerMemberId === context.membershipId && can(context, "daily_log.review"));
  if (!allowed) throw new AccessError("FORBIDDEN");
  if (project.archivedAt || project.status === "ARCHIVED") throw new AccessError("CONFLICT", "That project is archived.", { code: "DAILY_LOG_PROJECT_ARCHIVED" }, "STATE_DENIED");
  // A reviewer kept as it was is not re-judged: the submission skips one who no longer qualifies (§88).
  const current = await prisma.projectDailyLogSettings.findFirst({ where: { companyId: context.companyId, projectId: project.id }, select: { reviewerMemberId: true } });
  if (input.reviewerMemberId && input.reviewerMemberId !== current?.reviewerMemberId && !(await canReviewProjectLogs(context.companyId, project.id, input.reviewerMemberId))) {
    throw new AccessError("VALIDATION_ERROR", "Choose someone who can review this project's daily logs.", { code: "DAILY_LOG_REVIEWER_INVALID", reviewerMemberId: ["Choose someone who can review this project's daily logs."] }, "SCOPE_DENIED");
  }
  await prisma.$transaction(async (tx) => {
    await tx.projectDailyLogSettings.upsert({
      where: { projectId: project.id },
      create: { companyId: context.companyId, projectId: project.id, logsRequired: input.logsRequired, reviewerMemberId: input.reviewerMemberId, workingDays: input.workingDays, updatedByMemberId: context.membershipId },
      update: { logsRequired: input.logsRequired, reviewerMemberId: input.reviewerMemberId, workingDays: input.workingDays, updatedByMemberId: context.membershipId },
    });
    await recordUserAction(
      context,
      { actionKey: AuditAction.DAILY_LOG_SETTINGS_UPDATED, entity: { type: "Project", id: project.id, label: "Project daily log settings" }, after: { ...input } },
      { tx },
    );
  });
  return resolveDailyLogSettings(context.companyId, project.id);
}

