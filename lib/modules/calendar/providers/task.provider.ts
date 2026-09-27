import { buildTaskScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { CalendarPriority, CalendarProvider } from "../calendar.types";
import { compact, dateWindow, isPastDue, moduleOpen, onBusinessDate, projectFilter, projectRef, PROJECT_SELECT, SOURCE_LIMIT, sourceRows } from "./provider.helpers";

/**
 * Task dates (PRD #39 §54): the due date, or the start date of work that has
 * no due date yet. Reads through the task scope, so an engineer sees the tasks
 * of their own projects and nothing else (PRD #39 §179). Indexed by
 * (companyId, dueDate) and (projectId).
 */
const PRIORITY: Record<string, CalendarPriority> = { LOW: "LOW", MEDIUM: "NORMAL", HIGH: "HIGH", CRITICAL: "CRITICAL" };

export const taskProvider: CalendarProvider = {
  key: "tasks",
  moduleKey: "tasks",
  categories: ["TASK"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => moduleOpen(context, "tasks", "task.view"),
  async getEvents(input) {
    const { context, filters } = input;
    const window = dateWindow(input);
    const rows = await sourceRows(input, prisma.task.findMany({
      where: {
        AND: [
          buildTaskScopeWhere(context),
          { archivedAt: null, status: { not: "ARCHIVED" } },
          { OR: [{ dueDate: window }, { dueDate: null, startDate: window }] },
          projectFilter(input),
          filters.myOnly ? { assigneeMemberId: context.membershipId } : {},
          filters.memberIds?.length ? { assigneeMemberId: { in: filters.memberIds } } : {},
        ],
      },
      take: SOURCE_LIMIT,
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        startDate: true,
        project: PROJECT_SELECT,
        assignee: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
      },
    }));

    return compact(
      rows.map((row) => {
        const date = row.dueDate ?? row.startDate!;
        const open = row.status !== "COMPLETED";
        const overdue = Boolean(row.dueDate) && open && isPastDue(row.dueDate!, input);
        return onBusinessDate(input, date, {
          id: `tasks:${row.id}`,
          sourceType: "task",
          sourceId: row.id,
          providerKey: "tasks",
          title: row.dueDate ? row.title : `Starts: ${row.title}`,
          subtitle: row.project?.name,
          category: "TASK",
          status: overdue ? "OVERDUE" : row.status,
          priority: PRIORITY[row.priority],
          severity: overdue ? "warning" : undefined,
          project: projectRef(row.project),
          participants: row.assignee
            ? [{ memberId: row.assignee.id, name: `${row.assignee.user.firstName} ${row.assignee.user.lastName}` }]
            : undefined,
          href: `/tasks/${row.id}`,
          metadata: { sourceLabel: "Task", moduleKey: "tasks" },
        });
      }),
    );
  },
};
