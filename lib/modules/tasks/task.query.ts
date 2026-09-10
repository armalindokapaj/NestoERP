import { firstValue } from "@/lib/modules/shared/list-query";
import {
  TASK_DUE_FILTERS,
  TASK_SORT_KEYS,
  taskListQuerySchema,
  type TaskDueFilter,
  type TaskListQuery,
  type TaskSortKey,
} from "./task.schema";

/**
 * Turns URL search parameters into a validated list query (PRD #11 §190).
 *
 * Shared by the pages and the API so `/tasks/all?status=BLOCKED` and
 * `GET /api/tasks?status=BLOCKED` behave identically. Unknown values are
 * dropped rather than passed through to Prisma (PRD #11 §190).
 */
type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return firstValue(params[key]);
}

const STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function list<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));
  return values.length > 0 ? values : undefined;
}

/** Defaults a section applies on top of the query string (PRD #11 §26–§30). */
export type TaskQueryDefaults = Partial<
  Pick<TaskListQuery, "archived" | "mine" | "openOnly" | "completedOnly" | "due" | "sort">
>;

export function parseTaskListQuery(
  params: RawParams,
  defaults: TaskQueryDefaults = {},
): TaskListQuery {
  const sortValue = read(params, "sort");
  const sort: TaskSortKey = (TASK_SORT_KEYS as readonly string[]).includes(sortValue ?? "")
    ? (sortValue as TaskSortKey)
    : (defaults.sort ?? "due-asc");

  const dueValue = read(params, "due");
  const due: TaskDueFilter | undefined = (TASK_DUE_FILTERS as readonly string[]).includes(
    dueValue ?? "",
  )
    ? (dueValue as TaskDueFilter)
    : defaults.due;

  const page = Number.parseInt(read(params, "page") ?? "1", 10);
  const limit = Number.parseInt(read(params, "limit") ?? "25", 10);

  return taskListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), STATUSES),
    priority: list(read(params, "priority"), PRIORITIES),
    projectId: read(params, "projectId") || undefined,
    assigneeMemberId: read(params, "assignee") || undefined,
    createdByMemberId: read(params, "createdBy") || undefined,
    due,
    dueFrom: read(params, "dueFrom") || undefined,
    dueTo: read(params, "dueTo") || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25,
    sort,
    archived: defaults.archived ?? read(params, "archived") === "true",
    mine: defaults.mine ?? read(params, "mine") === "true",
    openOnly: defaults.openOnly ?? false,
    completedOnly: defaults.completedOnly ?? false,
  });
}
