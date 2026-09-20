import { can, canAccessModule } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { readableMeetingWhere } from "@/lib/modules/meetings/meeting.permissions";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { listApprovals } from "@/lib/modules/approvals/approvals.service";
import { planningOpen, readableMilestoneWhere } from "@/lib/modules/project-planning/planning.permissions";

export type ProjectWorkItem = {
  key: "tasks" | "approvals" | "meetings" | "documents";
  label: string;
  count: number;
  href: string;
};

export type ProjectUpcomingItem = {
  id: string;
  kind: "meeting" | "milestone" | "deadline";
  title: string;
  at: string;
  href: string;
};

/** Personalized counts from the canonical modules, each behind its own door. */
export async function projectMyWork(context: UserContext, projectId: string): Promise<ProjectWorkItem[]> {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);
  const items: Array<Promise<ProjectWorkItem | null>> = [];

  if (canAccessModule(context, "tasks") && can(context, "task.view") && can(context, "project.task.view")) {
    items.push(prisma.task.count({
      where: { companyId: context.companyId, projectId, assigneeMemberId: context.membershipId, archivedAt: null, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
    }).then((count) => ({ key: "tasks" as const, label: "Tasks assigned to me", count, href: `/tasks/my-tasks?projectId=${encodeURIComponent(projectId)}` })));
  }

  if (canAccessModule(context, "approvals") && can(context, "approvals.view")) {
    items.push(listApprovals(context, approvalQuerySchema.parse({ tab: "waiting", projectId, limit: 100 }))
      .then((result) => ({ key: "approvals" as const, label: "Approvals pending", count: result.items.length, href: `/approvals?projectId=${encodeURIComponent(projectId)}` }))
      .catch(() => null));
  }

  if (canAccessModule(context, "meetings") && can(context, "meeting.view")) {
    items.push(prisma.meeting.count({
      where: { AND: [readableMeetingWhere(context), { projectId, archivedAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startsAt: { gte: now, lte: week } }] },
    }).then((count) => ({ key: "meetings" as const, label: "Meetings this week", count, href: `/meetings?projectId=${encodeURIComponent(projectId)}` })));
  }

  if (canAccessModule(context, "documents") && can(context, "document.view") && can(context, "project.document.view")) {
    items.push(buildDocumentAccessWhere(context).then((access) => prisma.documentReview.count({
      where: { companyId: context.companyId, reviewerMemberId: context.membershipId, status: "PENDING", version: { document: { is: { AND: [access, { projectId, status: "ACTIVE" }] } } } },
    })).then((count) => ({ key: "documents" as const, label: "Documents requiring attention", count, href: `/documents?projectId=${encodeURIComponent(projectId)}` })).catch(() => null));
  }

  return (await Promise.all(items)).filter((item): item is ProjectWorkItem => item !== null);
}

/** Maximum five dated items from visible Meetings, Planning and Project data. */
export async function projectUpcoming(
  context: UserContext,
  project: { id: string; schedule: { endDate: string | null } },
): Promise<ProjectUpcomingItem[]> {
  const now = new Date();
  const reads: Array<Promise<ProjectUpcomingItem[]>> = [];

  if (canAccessModule(context, "meetings") && can(context, "meeting.view")) {
    reads.push(prisma.meeting.findMany({
      where: { AND: [readableMeetingWhere(context), { projectId: project.id, archivedAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startsAt: { gte: now } }] },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, title: true, startsAt: true },
    }).then((rows) => rows.map((row) => ({ id: `meeting:${row.id}`, kind: "meeting" as const, title: row.title, at: row.startsAt.toISOString(), href: `/meetings/${row.id}` }))));
  }

  if (planningOpen(context)) {
    reads.push(prisma.projectMilestone.findMany({
      where: {
        AND: [readableMilestoneWhere(context), {
          projectId: project.id,
          archivedAt: null,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
          OR: [{ forecastDate: { gte: now } }, { forecastDate: null, plannedDate: { gte: now } }, { forecastDate: null, plannedDate: null, baselineDate: { gte: now } }],
        }],
      },
      take: 12,
      select: { id: true, name: true, forecastDate: true, plannedDate: true, baselineDate: true },
    }).then((rows) => rows.map((row) => ({
      id: `milestone:${row.id}`,
      kind: "milestone" as const,
      title: row.name,
      at: (row.forecastDate ?? row.plannedDate ?? row.baselineDate)!.toISOString(),
      href: `/projects/${project.id}/planning?milestone=${row.id}`,
    }))));
  }

  const items = (await Promise.all(reads)).flat();
  if (project.schedule.endDate && new Date(project.schedule.endDate) >= now) {
    items.push({ id: `deadline:${project.id}`, kind: "deadline", title: "Expected project completion", at: project.schedule.endDate, href: `/projects/${project.id}/planning` });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5);
}
