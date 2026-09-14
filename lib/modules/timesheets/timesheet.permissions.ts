import type { Prisma } from "@prisma/client";

import { can, canAccessModule, getModuleScope, isModuleEnabled } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { delegationsTo } from "@/lib/core/approvals/approval-delegations";

/**
 * Who may see and change which timesheets (PRD #42 §120-§127, §229-§236).
 *
 * Company + timesheet permission + the member relationship + scope + the
 * week's state (§121). Everyone reads their own. Beyond that:
 *
 *   - the designated approver of a week, and anybody standing in for them
 *   - team readers, narrowed by their timesheet scope: company, their own
 *     department, or the people on projects they manage
 *   - project readers see the hours logged on projects they can open, and only
 *     team readers see what somebody wrote about them (§126, §230)
 *
 * Nothing here trusts a member id from the browser: "mine" is always the
 * signed-in member (§232).
 */

export const MODULE = "timesheets" as const;

export function timesheetsOpen(context: UserContext): boolean {
  return isModuleEnabled(context, MODULE) && canAccessModule(context, MODULE) && can(context, "timesheet.view_own");
}

/** The people whose weeks this reader oversees as a team reader (§87, §123-§125). */
export function teamMemberWhere(context: UserContext): Prisma.CompanyMemberWhereInput | null {
  if (!can(context, "timesheet.team.view")) return null;
  const scope = getModuleScope(context, MODULE);
  if (scope === "COMPANY" || scope === "SYSTEM") return { companyId: context.companyId };
  if (scope === "DEPARTMENT") return context.department ? { companyId: context.companyId, departmentId: context.department.id } : null;
  if (scope === "PROJECT" || scope === "ASSIGNED") {
    return {
      companyId: context.companyId,
      projectMemberships: { some: { status: "ACTIVE", project: { projectManagerMemberId: context.membershipId } } },
    };
  }
  return null;
}

/** Weeks this reader may open (§122-§125). */
export async function readableTimesheetWhere(context: UserContext): Promise<Prisma.TimesheetWhereInput> {
  const doors: Prisma.TimesheetWhereInput[] = [{ memberId: context.membershipId }];
  if (can(context, "timesheet.approve")) {
    doors.push({ approverMemberId: context.membershipId });
    doors.push({ member: { timesheetApprover: { is: { approverMemberId: context.membershipId } } } });
    const lent = await delegationsTo(context.companyId, context.membershipId, "timesheets");
    if (lent.length > 0) doors.push({ status: "SUBMITTED", approverMemberId: { in: lent.map((row) => row.fromMemberId) } });
  }
  const team = teamMemberWhere(context);
  if (team) doors.push({ member: team });
  return { companyId: context.companyId, OR: doors };
}

/** Work logs on projects this reader may report on (§90-§92, §124). */
export function projectLogWhere(context: UserContext): Prisma.WorkLogWhereInput | null {
  if (!can(context, "timesheet.project.view") || !canAccessModule(context, "projects") || !can(context, "project.view")) return null;
  return { companyId: context.companyId, project: { is: buildProjectScopeWhere(context) } };
}

/** Whether entry text is shown to this reader in project reporting (§126, §178, §230). */
export function seesEntryDetail(context: UserContext): boolean {
  return can(context, "timesheet.team.view");
}

/** A returned or rejected week goes back to its member to correct and submit again (§64, §65). */
export const EDITABLE_STATUSES = ["DRAFT", "RETURNED", "REJECTED"] as const;

export function isEditableStatus(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}
