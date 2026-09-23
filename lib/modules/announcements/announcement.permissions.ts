import type { Prisma } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { hasGroupStanding } from "@/lib/context/build-context";
import type { UserContext } from "@/lib/context/types";
import type { AudienceType } from "./announcement.types";

/**
 * Who reads and who speaks (PRD #45 §28-§34, §49, §158-§160, §265, §266).
 *
 * Visibility is decided in the query, never after it: a published announcement
 * reaches the company, the members of its department, the people who can open
 * its project, or the members named on it. An audience never opens anything
 * else — a project announcement does not let anybody into the project.
 * Writing is a separate door per audience, and drafts, schedules, metrics and
 * the acknowledgment list belong to the author and the audience's managers.
 */

export const MODULE = "announcements" as const;
export const RECORD = "announcement" as const;
export const ACTIVITY_ENTITY = "Announcement";

export function announcementsOpen(context: UserContext): boolean {
  return isModuleEnabled(context, MODULE) && canAccessModule(context, MODULE) && can(context, "announcement.view");
}

function projectDoor(context: UserContext): Prisma.ProjectWhereInput | null {
  return canAccessModule(context, "projects") && can(context, "project.view") ? buildProjectScopeWhere(context) : null;
}

/** The audiences this member belongs to, as a where-clause (§28-§31, §267). */
export function audienceWhere(context: UserContext): Prisma.AnnouncementWhereInput {
  const door = projectDoor(context);
  return {
    OR: [
      { audienceType: "COMPANY" },
      ...(context.department ? [{ audienceType: "DEPARTMENT" as const, departmentId: context.department.id }] : []),
      // "Explicitly authorised management" of department notices (§29).
      ...(can(context, "announcement.manage_department") ? [{ audienceType: "DEPARTMENT" as const }] : []),
      ...(door ? [{ audienceType: "PROJECT" as const, project: { is: door } }] : []),
      { audienceType: "SELECTED_MEMBERS", selectedMembers: { some: { memberId: context.membershipId } } },
    ],
  };
}

/**
 * A Group announcement (Activity Center §14, §16): written in one company by an
 * author with group standing, read by the members of every active company of
 * the same group who hold `announcement.view` there — each reader's own grant
 * in their own company decides, never the author's.
 */
export function groupAudienceWhere(context: UserContext): Prisma.AnnouncementWhereInput {
  return { audienceType: "GROUP", company: { is: { parentGroupId: context.parentGroupId, status: "ACTIVE" } } };
}

/**
 * Every announcement addressed to this member: their own company's audiences,
 * plus Group announcements from any company of their group. Use this, not
 * `audienceWhere` with a company constraint, wherever a reader's feed is built.
 */
export function reachWhere(context: UserContext): Prisma.AnnouncementWhereInput {
  return { OR: [{ companyId: context.companyId, AND: [audienceWhere(context)] }, groupAudienceWhere(context)] };
}

/** What this member may manage: their own, and the audiences their grants speak to. */
export function managedWhere(context: UserContext): Prisma.AnnouncementWhereInput {
  const door = projectDoor(context);
  return {
    OR: [
      { authorMemberId: context.membershipId },
      ...(can(context, "announcement.manage_company") ? [{ audienceType: "COMPANY" as const }, { audienceType: "GROUP" as const }] : []),
      ...(can(context, "announcement.manage_department") ? [{ audienceType: "DEPARTMENT" as const }] : []),
      ...(can(context, "announcement.manage_project") && door ? [{ audienceType: "PROJECT" as const, project: { is: door } }] : []),
      // Notices to named people stay private to their author and the company authority (§49).
      ...(can(context, "announcement.manage_selected_members") && can(context, "announcement.manage_company") ? [{ audienceType: "SELECTED_MEMBERS" as const }] : []),
    ],
  };
}

export function readableAnnouncementWhere(context: UserContext): Prisma.AnnouncementWhereInput {
  if (!announcementsOpen(context)) return { id: { in: [] } };
  return {
    OR: [
      { AND: [{ status: { in: ["PUBLISHED", "EXPIRED"] } }, reachWhere(context)] },
      { companyId: context.companyId, AND: [managedWhere(context)] },
    ],
  };
}

/** Whether this member may address this audience at all (§33, §157). The project itself is checked in scope by the service. */
export function canAddress(context: UserContext, audienceType: AudienceType): boolean {
  if (!announcementsOpen(context) || !can(context, "announcement.create")) return false;
  switch (audienceType) {
    case "COMPANY":
      return can(context, "announcement.manage_company");
    case "DEPARTMENT":
      return can(context, "announcement.manage_department");
    case "PROJECT":
      return can(context, "announcement.manage_project") && projectDoor(context) !== null;
    case "SELECTED_MEMBERS":
      return can(context, "announcement.manage_selected_members");
    case "GROUP":
      // Speaking to the whole group takes the company authority and standing in the group (§139).
      return can(context, "announcement.manage_company") && hasGroupStanding([context]);
  }
}

export function addressableAudiences(context: UserContext): AudienceType[] {
  return (["GROUP", "COMPANY", "DEPARTMENT", "PROJECT", "SELECTED_MEMBERS"] as const).filter((type) => canAddress(context, type));
}

export { projectDoor };
