import type { Prisma } from "@prisma/client";

import { buildTaskScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import type { TaskListQuery, TaskSortKey } from "./task.schema";
import { dayBounds, startOfWeek } from "./task.status";

/**
 * Database access for Tasks (PRD #11 §100, §101).
 *
 * The repository does queries; the service owns permissions, validation,
 * transactions and activity. Scope is still applied here, because a query that
 * left it to the caller would be one refactor away from leaking (PRD #11 §20).
 */

const SORT_ORDER: Record<TaskSortKey, Prisma.TaskOrderByWithRelationInput[]> = {
  "due-asc": [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
  "due-desc": [{ dueDate: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
  "priority-desc": [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }],
  "priority-asc": [{ priority: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
  "updated-desc": [{ updatedAt: "desc" }],
  "created-desc": [{ createdAt: "desc" }],
  "title-asc": [{ title: "asc" }],
  "title-desc": [{ title: "desc" }],
};

/** A person shown on a task row: identity only, never HR fields (PRD #11 §123). */
const PERSON_SELECT = {
  id: true,
  status: true,
  user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
} satisfies Prisma.CompanyMemberSelect;

/** Columns every list row needs — and nothing more (PRD #11 §183). */
const SUMMARY_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  assignee: { select: PERSON_SELECT },
} satisfies Prisma.TaskSelect;

export type TaskSummaryRow = Prisma.TaskGetPayload<{ select: typeof SUMMARY_SELECT }>;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  description: true,
  preArchiveStatus: true,
  startDate: true,
  module: true,
  entityType: true,
  entityId: true,
  createdAt: true,
  archivedAt: true,
  projectId: true,
  assigneeMemberId: true,
  createdByMemberId: true,
  blockedAt: true,
  blockedReason: true,
  blockedByMemberId: true,
  creator: { select: PERSON_SELECT },
} satisfies Prisma.TaskSelect;

export type TaskDetailRow = Prisma.TaskGetPayload<{ select: typeof DETAIL_SELECT }>;

/** Open means "not finished and not filed away" (PRD #11 §28). */
const OPEN_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED"] as const;

/**
 * Builds the full `where` for a list request.
 *
 * Order: company → permission scope → archive state → mine → search → filters
 * (PRD #11 §20, §104).
 */
export function buildTaskListWhere(
  context: UserContext,
  query: TaskListQuery,
  now: Date = new Date(),
): Prisma.TaskWhereInput {
  const scope = buildTaskScopeWhere(context);

  const archiveClause: Prisma.TaskWhereInput = query.archived
    ? { OR: [{ archivedAt: { not: null } }, { status: "ARCHIVED" }] }
    : { archivedAt: null, status: { not: "ARCHIVED" } };

  const filters: Prisma.TaskWhereInput[] = [scope, archiveClause];

  if (query.mine) filters.push({ assigneeMemberId: context.membershipId });
  if (query.openOnly) filters.push({ status: { in: [...OPEN_STATUSES] } });
  if (query.completedOnly) filters.push({ status: "COMPLETED" });

  const search = searchClause(query.search, ["title", "description"]);
  if (search) {
    const term = query.search!.trim();
    // Project and assignee names are searchable, but only through the scoped
    // graph — a project the user cannot reach never surfaces one of its tasks
    // (PRD #11 §34).
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.TaskWhereInput),
        { project: { name: { contains: term, mode: "insensitive" } } },
        { project: { code: { contains: term, mode: "insensitive" } } },
        {
          assignee: {
            user: {
              OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.priority?.length) filters.push({ priority: { in: query.priority } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.assigneeMemberId) filters.push({ assigneeMemberId: query.assigneeMemberId });
  if (query.createdByMemberId) filters.push({ createdByMemberId: query.createdByMemberId });

  // The record a task came from. These narrow the scoped list; the scope clause
  // above still decides what is reachable at all (PRD #11 §55, PRD #17 §138).
  if (query.moduleKey) filters.push({ module: query.moduleKey });
  if (query.entityType) filters.push({ entityType: query.entityType });
  if (query.entityId) filters.push({ entityId: query.entityId });

  const due = dueClause(query, now);
  if (due) filters.push(due);

  return { AND: filters };
}

/**
 * Due-date presets (PRD #11 §38).
 *
 * "Overdue" and "today" also exclude finished work, because a task completed
 * last week is not overdue however old its due date is (PRD #11 §142).
 */
function dueClause(query: TaskListQuery, now: Date): Prisma.TaskWhereInput | undefined {
  const open: Prisma.TaskWhereInput = { status: { in: [...OPEN_STATUSES] } };

  switch (query.due) {
    case "overdue":
      return { AND: [open, { dueDate: { lt: now } }] };
    case "today": {
      const { start, end } = dayBounds(now);
      return { AND: [open, { dueDate: { gte: start, lt: end } }] };
    }
    case "week": {
      const start = startOfWeek(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { dueDate: { gte: start, lt: end } };
    }
    case "next7": {
      const { start } = dayBounds(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { dueDate: { gte: start, lt: end } };
    }
    case "none":
      return { dueDate: null };
    default:
      break;
  }

  const range: Prisma.DateTimeFilter = {};
  if (query.dueFrom) range.gte = query.dueFrom;
  if (query.dueTo) range.lte = query.dueTo;
  return Object.keys(range).length > 0 ? { dueDate: range } : undefined;
}

export async function listTasks(context: UserContext, query: TaskListQuery) {
  const where = buildTaskListWhere(context, query);

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: SORT_ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
    }),
    prisma.task.count({ where }),
  ]);

  return { rows, total };
}

/** A list row from the Group workspace, which also says whose task it is. */
export type GroupTaskSummaryRow = TaskSummaryRow & { companyId: string };

/**
 * The tasks of several companies as one list (Workspace Context §32, §58).
 *
 * Each context is the person's own in that company, so the union below is
 * exactly the answers the company pages give: every branch starts with that
 * company's boundary, then its permission scope and the same filters. `mine`
 * reads each branch's own membership, which is what "my work" means in a
 * company they belong to under a different membership id. Search, sort and
 * pagination run over the union in the database, never over a merged page.
 */
export async function listTasksForContexts(contexts: UserContext[], query: TaskListQuery) {
  if (contexts.length === 0) return { rows: [] as GroupTaskSummaryRow[], total: 0 };
  const now = new Date();
  const where: Prisma.TaskWhereInput = { OR: contexts.map((context) => buildTaskListWhere(context, query, now)) };

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      select: { ...SUMMARY_SELECT, companyId: true },
      // The id keeps a page boundary stable when two companies' tasks tie.
      orderBy: [...SORT_ORDER[query.sort], { id: "asc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
    }),
    prisma.task.count({ where }),
  ]);

  return { rows, total };
}

/** A single task, already narrowed to what this caller may see (PRD #11 §120). */
export async function findTaskInScope(
  context: UserContext,
  taskId: string,
): Promise<TaskDetailRow | null> {
  return prisma.task.findFirst({
    where: { AND: [buildTaskScopeWhere(context), { id: taskId }] },
    select: DETAIL_SELECT,
  });
}

/** Cheap existence check used before a mutation. */
export async function taskInScopeExists(context: UserContext, taskId: string): Promise<boolean> {
  const found = await prisma.task.findFirst({
    where: { AND: [buildTaskScopeWhere(context), { id: taskId }] },
    select: { id: true },
  });
  return Boolean(found);
}

export async function listTaskActivity(
  context: UserContext,
  taskId: string,
  options: { page: number; limit: number },
) {
  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    entityType: "Task",
    entityId: taskId,
  };

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: skipFor(options.page, options.limit),
      take: options.limit,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        actorMemberId: true,
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  return { rows, total };
}

/**
 * The overview counters (PRD #11 §7, §185).
 *
 * Counted in the database under the caller's scope: never by loading tasks into
 * the browser and grouping them there (PRD #11 §245).
 */
export async function taskOverviewStats(context: UserContext, now: Date = new Date()) {
  const scope = buildTaskScopeWhere(context);
  const live: Prisma.TaskWhereInput = {
    AND: [scope, { archivedAt: null, status: { not: "ARCHIVED" } }],
  };
  const open: Prisma.TaskWhereInput = { AND: [live, { status: { in: [...OPEN_STATUSES] } }] };
  const { start: todayStart, end: todayEnd } = dayBounds(now);

  const [openCount, dueToday, overdue, blocked, completedThisWeek, mine] = await Promise.all([
    prisma.task.count({ where: open }),
    prisma.task.count({
      where: { AND: [open, { dueDate: { gte: todayStart, lt: todayEnd } }] },
    }),
    prisma.task.count({ where: { AND: [open, { dueDate: { lt: now } }] } }),
    prisma.task.count({ where: { AND: [live, { status: "BLOCKED" }] } }),
    prisma.task.count({
      where: { AND: [live, { status: "COMPLETED" }, { completedAt: { gte: startOfWeek(now) } }] },
    }),
    prisma.task.count({ where: { AND: [open, { assigneeMemberId: context.membershipId }] } }),
  ]);

  return { open: openCount, dueToday, overdue, blocked, completedThisWeek, mine };
}

/** High and critical work still open, for the overview attention list. */
export async function priorityTasks(context: UserContext, limit = 5) {
  return prisma.task.findMany({
    where: {
      AND: [
        buildTaskScopeWhere(context),
        { archivedAt: null, status: { in: [...OPEN_STATUSES] } },
        { priority: { in: ["HIGH", "CRITICAL"] } },
      ],
    },
    select: SUMMARY_SELECT,
    orderBy: [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    take: limit,
  });
}

/** High and critical open work across several companies, for the Group overview's attention list. */
export async function priorityTasksForContexts(contexts: UserContext[], limit = 5): Promise<GroupTaskSummaryRow[]> {
  if (contexts.length === 0) return [];
  return prisma.task.findMany({
    where: {
      AND: [
        { OR: contexts.map((context) => buildTaskScopeWhere(context)) },
        { archivedAt: null, status: { in: [...OPEN_STATUSES] } },
        { priority: { in: ["HIGH", "CRITICAL"] } },
      ],
    },
    select: { ...SUMMARY_SELECT, companyId: true },
    orderBy: [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: limit,
  });
}

/**
 * Filter dropdown values (PRD #11 §36, §37, §221).
 *
 * Options are derived from the tasks the caller can already see, so a filter
 * can never name a project or a colleague they may not reach.
 */
export async function taskFilterOptions(context: UserContext) {
  const scope = buildTaskScopeWhere(context);

  const [projects, assignees] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: context.companyId, tasks: { some: scope } },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, assignedTasks: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { firstName: "asc" } },
      take: 100,
    }),
  ]);

  return {
    projects: projects.map((project) => ({ id: project.id, name: `${project.name} (${project.code})` })),
    assignees: assignees.map((member) => ({
      id: member.id,
      name: `${member.user.firstName} ${member.user.lastName}`,
    })),
  };
}
