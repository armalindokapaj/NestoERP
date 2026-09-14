import type { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import type { MilestoneCapabilities, PlanningCapabilities } from "./planning.types";

/**
 * Who may see and change which plans (PRD #44 §77-§95, §182-§185, §225-§235).
 *
 * Company + project access + a planning permission + the record's state. A
 * phase or milestone belongs to its project: nobody reads one without being
 * able to open that project, and owning a milestone grants nothing (§48). An
 * archived project's plan stays readable and takes no edits (§273).
 */

export const MODULE = "projects" as const;
export const RECORD = "project_milestone" as const;
export const ACTIVITY_ENTITY = "ProjectMilestone";
export const PHASE_ACTIVITY_ENTITY = "ProjectPhase";
export const RECORD_LINK_TYPE = "MILESTONE_RECORD";

export function planningOpen(context: UserContext): boolean {
  return isModuleEnabled(context, MODULE) && canAccessModule(context, MODULE) && can(context, "project.view") && can(context, "project_planning.view");
}

/** Projects whose plan this reader can open: the only door to it (§79, §225). */
export function planningProjectDoor(context: UserContext): Prisma.ProjectWhereInput | null {
  return planningOpen(context) ? buildProjectScopeWhere(context) : null;
}

export function readableMilestoneWhere(context: UserContext): Prisma.ProjectMilestoneWhereInput {
  const door = planningProjectDoor(context);
  if (!door) return { id: { in: [] } };
  return { companyId: context.companyId, project: { is: door } };
}

export function readablePhaseWhere(context: UserContext): Prisma.ProjectPhaseWhereInput {
  const door = planningProjectDoor(context);
  if (!door) return { id: { in: [] } };
  return { companyId: context.companyId, project: { is: door } };
}

type ProjectState = { archived: boolean; baselineLocked: boolean };

export function planningCapabilities(context: UserContext, project: ProjectState): PlanningCapabilities {
  const open = planningOpen(context) && !project.archived;
  const has = (permission: Permission) => open && can(context, permission);
  return {
    canManage: has("project_planning.manage"),
    canCreatePhase: has("project_planning.phase.create"),
    canEditPhase: has("project_planning.phase.edit"),
    canArchivePhase: has("project_planning.phase.archive"),
    canCreateMilestone: has("project_planning.milestone.create"),
    canEditMilestone: has("project_planning.milestone.edit"),
    canComplete: has("project_planning.milestone.complete"),
    canReopen: has("project_planning.milestone.reopen"),
    canManageBaseline: baselineMovable(context, project) && open,
    canManageDependencies: has("project_planning.dependencies.manage"),
    canManageBlockers: has("project_planning.blockers.manage"),
    canApplyTemplate: has("project_planning.phase.create") && has("project_planning.milestone.create"),
    canCreateTask: has("project_planning.milestone.edit") && canAccessModule(context, "tasks") && can(context, "task.create"),
    canLockBaseline: has("project_planning.baseline.manage") && !project.baselineLocked,
    canUnlockBaseline: has("project_planning.settings.manage") && project.baselineLocked,
  };
}

/** The baseline moves with its own grant; once locked, only with the planning authority (§22, §76). */
export function baselineMovable(context: UserContext, project: Pick<ProjectState, "baselineLocked">): boolean {
  if (!can(context, "project_planning.baseline.manage")) return false;
  return !project.baselineLocked || can(context, "project_planning.settings.manage");
}

export function milestoneCapabilities(context: UserContext, project: ProjectState, status: string, archived: boolean): MilestoneCapabilities {
  const plan = planningCapabilities(context, project);
  const live = !archived;
  const completed = status === "COMPLETED";
  const edit = live && plan.canEditMilestone;
  const documentsOpen = canAccessModule(context, "documents") && can(context, "document.view");
  return {
    canEdit: edit,
    canComplete: live && plan.canComplete && !completed && status !== "CANCELLED",
    canReopen: live && plan.canReopen && completed,
    canArchive: live && plan.canManage,
    canChangeBaseline: live && plan.canManageBaseline,
    canManageDependencies: live && plan.canManageDependencies,
    canManageBlockers: live && plan.canManageBlockers,
    canLinkTasks: edit && canAccessModule(context, "tasks") && can(context, "task.view"),
    canCreateTask: live && plan.canCreateTask,
    canLinkMeetings: edit && isModuleEnabled(context, "meetings") && canAccessModule(context, "meetings") && can(context, "meeting.view"),
    canLinkDailyLogs: edit && isModuleEnabled(context, "dailyLogs") && canAccessModule(context, "dailyLogs") && can(context, "daily_log.view"),
    canUploadDocuments: edit && documentsOpen && can(context, "document.create"),
    canViewDocuments: documentsOpen,
  };
}
