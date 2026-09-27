import { Prisma } from "@prisma/client";

import { buildTaskScopeWhere } from "@/lib/access/scope";
import { companyDays } from "@/lib/core/notifications/company-day";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { searchClause, skipFor } from "@/lib/modules/shared/list-query";
import type { TaskListQuery, TaskSortKey } from "./task.schema";
import { startOfWeek } from "./task.status";

/**
 * Database access for Tasks (PRD #11 §100, §101).
 *
 * The repository does queries; the service owns permissions, validation,
 * transactions and activity. Scope is still applied here, because a query that
 * left it to the caller would be one refactor away from leaking (PRD #11 §20).
 */

/**
 * The allowlisted sorts (AUD-08 §3, §4, DT-04).
 *
 * Every order ends in the task id, so two tasks with the same due date,
 * priority or title keep one order across every page and the API. Null
 * placement is explicit: a task without a due date sorts after every dated
 * task in both directions. Priority compares the enum's declared order
 * (LOW < MEDIUM < HIGH < CRITICAL), never its label.
 */
const SORT_ORDER: Record<TaskSortKey, Prisma.TaskOrderByWithRelationInput[]> = {
  "due-asc": [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }, { id: "asc" }],
  "due-desc": [{ dueDate: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "asc" }],
  "priority-desc": [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  "priority-asc": [{ priority: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  "updated-desc": [{ updatedAt: "desc" }, { id: "asc" }],
  "created-desc": [{ createdAt: "desc" }, { id: "asc" }],
  "title-asc": [{ title: "asc" }, { id: "asc" }],
  "title-desc": [{ title: "desc" }, { id: "asc" }],
};

/** One page and its total read from one snapshot (AUD-08 §4, DT-06). */
const SNAPSHOT = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead };

const DAY_MS = 86_400_000;

/** The company's calendar day now, `YYYY-MM-DD` (PRD #51 §48): what the day presets compare against. */
async function companyToday(companyId: string, now: Date): Promise<string> {
  return (await companyDays(companyId))(now).day;
}

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
  version: true,
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
  /** The company's calendar day, `YYYY-MM-DD`; UTC's when the caller does not know it. */
  today: string = now.toISOString().slice(0, 10),
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

  const due = dueClause(query, now, today);
  if (due) filters.push(due);

  return { AND: filters };
}

/**
 * Due-date presets (PRD #11 §38).
 *
 * "Overdue" and "today" also exclude finished work, because a task completed
 * last week is not overdue however old its due date is (PRD #11 §142).
 *
 * A due date is a calendar day stored as that day's UTC midnight (AUD-09 §4),
 * so the day presets compare against the company's own calendar day, `today`
 * (`YYYY-MM-DD` in the company's timezone), as UTC midnights in half-open
 * `[start, end)` ranges — never the server process's local midnight, which
 * put a Tirane "today" on the wrong day between 00:00 and 02:00 local
 * (AUD-08 §3, DT-03). "Overdue" keeps PRD #11 §142's instant rule,
 * `dueDate < now`, which the row badge (`isTaskOverdue`) shares.
 *
 * `dueFrom`/`dueTo` are inclusive calendar days: `dueTo` covers its whole day
 * (before, `lte` midnight dropped a timestamped due date later that day).
 */
function dueClause(query: TaskListQuery, now: Date, today: string): Prisma.TaskWhereInput | undefined {
  const open: Prisma.TaskWhereInput = { status: { in: [...OPEN_STATUSES] } };
  const start = new Date(`${today}T00:00:00.000Z`);
  const plusDays = (from: Date, days: number) => new Date(from.getTime() + days * DAY_MS);

  switch (query.due) {
    case "overdue":
      return { AND: [open, { dueDate: { lt: now } }] };
    case "today":
      return { AND: [open, { dueDate: { gte: start, lt: plusDays(start, 1) } }] };
    case "week": {
      // Monday of the company's week: getUTCDay() of a UTC midnight is that day's weekday.
      const monday = plusDays(start, -((start.getUTCDay() + 6) % 7));
      return { dueDate: { gte: monday, lt: plusDays(monday, 7) } };
    }
    case "next7":
      return { dueDate: { gte: start, lt: plusDays(start, 7) } };
    case "none":
      return { dueDate: null };
    default:
      break;
  }

  const range: Prisma.DateTimeFilter = {};
  if (query.dueFrom) range.gte = query.dueFrom;
  if (query.dueTo) range.lt = plusDays(new Date(`${query.dueTo.toISOString().slice(0, 10)}T00:00:00.000Z`), 1);
  return Object.keys(range).length > 0 ? { dueDate: range } : undefined;
}

/**
 * One page of the list and its total (AUD-08 §3, §4, DT-03, DT-06).
 *
 * The page and the count share one predicate and one REPEATABLE READ
 * snapshot, so a task committed between the two statements cannot make the
 * total disagree with the rows (before, two pooled reads raced). The database
 * slices after scope, section and filters — never the visible page.
 */
export async function listTasks(context: UserContext, query: TaskListQuery) {
  const now = new Date();
  const where = buildTaskListWhere(context, query, now, await companyToday(context.companyId, now));

  const [rows, total] = await prisma.$transaction(
    [
      prisma.task.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: SORT_ORDER[query.sort],
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      prisma.task.count({ where }),
    ],
    SNAPSHOT,
  );

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
  // Each branch's day presets read its own company's calendar day (DT-03).
  const todays = await Promise.all(contexts.map((context) => companyToday(context.companyId, now)));
  const where: Prisma.TaskWhereInput = {
    OR: contexts.map((context, index) => buildTaskListWhere(context, query, now, todays[index])),
  };

  const [rows, total] = await prisma.$transaction(
    [
      prisma.task.findMany({
        where,
        select: { ...SUMMARY_SELECT, companyId: true },
        // The id (last in every order) keeps a page boundary stable when two companies' tasks tie.
        orderBy: SORT_ORDER[query.sort],
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      prisma.task.count({ where }),
    ],
    SNAPSHOT,
  );

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

  // Newest first with the id as tie-breaker; page and total from one snapshot (DT-04, DT-06).
  const [rows, total] = await prisma.$transaction([
    prisma.activity.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
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
  ], SNAPSHOT);

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
  // "Due today" is the company's calendar day, as the `due=today` list it links to (DT-03).
  const todayStart = new Date(`${await companyToday(context.companyId, now)}T00:00:00.000Z`);
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);

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
    orderBy: [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
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
