import type { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import type { DailyLogStatus, SectionKey } from "./daily-log.types";

/**
 * Who may see and change which daily logs (PRD #43 §126-§144, §192, §222-§236).
 *
 * Company + project access + a daily log permission + the record's state. A
 * log belongs to its project: nobody reads one without being able to open the
 * project, and each section is edited under its own grant, so a QA/QC
 * engineer links inspections without rewriting the workforce and a buyer notes
 * a delivery without touching delays. Nothing here trusts a reviewer, author
 * or project from the browser.
 */

export const MODULE = "dailyLogs" as const;
export const RECORD = "daily_log" as const;

export function dailyLogsOpen(context: UserContext): boolean {
  return isModuleEnabled(context, MODULE) && canAccessModule(context, MODULE) && can(context, "daily_log.view");
}

/** Projects this reader can open: the only door to their logs (§128, §229, §230). */
export function projectDoor(context: UserContext): Prisma.ProjectWhereInput | null {
  if (!canAccessModule(context, "projects") || !can(context, "project.view")) return null;
  return buildProjectScopeWhere(context);
}

/** Logs this reader may open. */
export function readableDailyLogWhere(context: UserContext): Prisma.DailyLogWhereInput {
  const door = dailyLogsOpen(context) ? projectDoor(context) : null;
  if (!door) return { id: { in: [] } };
  return { companyId: context.companyId, project: { is: door } };
}

/** A draft, or a log sent back, is still being written (§192). */
export const EDITABLE_STATUSES: readonly DailyLogStatus[] = ["DRAFT", "CORRECTION_REQUIRED"];

export function isEditable(status: DailyLogStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export const SECTION_PERMISSION: Record<SectionKey | "qaqc" | "hse", Permission> = {
  weather: "daily_log.edit",
  workforce: "daily_log.workforce.manage",
  activities: "daily_log.activity.manage",
  equipment: "daily_log.equipment.manage",
  deliveries: "daily_log.delivery.manage",
  visitors: "daily_log.visitor.manage",
  delays: "daily_log.delay.manage",
  instructions: "daily_log.instruction.manage",
  qaqc: "daily_log.qaqc.manage",
  hse: "daily_log.hse.manage",
};

/** Whether this reader may change a section of a log in this state. */
export function canEditSection(context: UserContext, status: DailyLogStatus, section: SectionKey | "qaqc" | "hse"): boolean {
  return dailyLogsOpen(context) && isEditable(status) && can(context, "daily_log.edit") && can(context, SECTION_PERMISSION[section]);
}
