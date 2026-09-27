import { z } from "zod";

import { dateOnlyToUtc, parseDateOnly } from "@/lib/forms/dates";

import {
  optionalDate,
  optionalEnum,
  optionalId,
  optionalText,
} from "@/lib/modules/shared/fields";
import { EDITABLE_STATUSES, REOPEN_STATUSES } from "./task.status";

/**
 * Task validation (PRD #11 §188–§190).
 *
 * `completedAt`, `archivedAt`, `companyId` and `createdByMemberId` are absent
 * from every input schema on purpose: they are server-controlled and must never
 * be accepted from the browser (PRD #11 §98, §116, §117).
 */

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const TASK_TITLE_MIN = 2;
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 10_000;

/**
 * A real calendar day, `YYYY-MM-DD`, between 1900 and 2199 (AUD-09 §4, FV-07):
 * the shared rule, `lib/forms/dates`. `new Date("2026-02-30")` rolls over to
 * 2 March, and `z.coerce.date()` accepts "1" as 2001: both would store a day
 * the person never chose.
 */
export function isCalendarDay(value: string): boolean {
  return parseDateOnly(value).ok;
}

/**
 * A task date: a calendar day (stored as that day's UTC midnight, as before),
 * a full ISO timestamp from an API client, or a Date from another module's
 * service. Anything else is refused rather than guessed at (AUD-09 §4).
 *
 * The day itself is read by `lib/forms/dates`; the omit/clear/set zod
 * fragments below stay here because `lib/forms/normalize` is a spec-driven
 * normalizer, not a zod schema (AUD-09: candidate for lib/forms).
 */
const taskDate = z.union([
  z.date(),
  z
    .string()
    .trim()
    .refine((value) => isCalendarDay(value) || z.string().datetime({ offset: true }).safeParse(value).success, {
      message: "Enter a real date as YYYY-MM-DD.",
    })
    .transform((value) => isCalendarDay(value) ? dateOnlyToUtc(value) : new Date(value)),
]);

/** Create: empty or absent is "no date". */
const createDate = z
  .union([taskDate, z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : (value as Date)));

/**
 * Update (AUD-09 §4, FV-05): absent keeps the saved value; `""` or `null` is
 * the person clearing it; a value replaces it. The three are never merged.
 */
const patchDate = z
  .union([taskDate, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : (value as Date)));

const patchText = (max: number) =>
  z
    .union([z.string().trim().max(max, `Keep this under ${max.toLocaleString("en")} characters.`), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value));

const patchId = z
  .union([z.string().trim().max(64), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value));

const title = z
  .string()
  .trim()
  .min(TASK_TITLE_MIN, `Task title must be at least ${TASK_TITLE_MIN} characters`)
  .max(TASK_TITLE_MAX, `Task title must be ${TASK_TITLE_MAX} characters or fewer`);

const taskFields = {
  title,
  description: optionalText(TASK_DESCRIPTION_MAX),
  projectId: optionalId,
  assigneeMemberId: optionalId,
  status: z.enum(EDITABLE_STATUSES as [string, ...string[]]).default("TODO"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  startDate: createDate,
  dueDate: createDate,
};

/** A task may not be scheduled to finish before it starts (PRD #11 §50). */
const scheduleRefinement = <T extends { startDate?: Date | null; dueDate?: Date | null }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (value) =>
      !value.startDate || !value.dueDate || value.startDate.getTime() <= value.dueDate.getTime(),
    { message: "Due date must be on or after the start date.", path: ["dueDate"] },
  );

export const createTaskSchema = scheduleRefinement(z.object(taskFields));

/**
 * The version the person reviewed (AUD-02 §3, §6). Carried through unparsed
 * so the mutation can tell "none given" (428, reload) from "not a version"
 * (422) — a schema default or coercion here would blur the two. It is a
 * precondition, never written: the version a task gets is the server's.
 * `versionUpdatedAt`, the old timestamp stamp, is no longer read.
 */
const expectedVersion = z.unknown().optional();

/**
 * An edit is a partial update (AUD-09 §4, FV-05, FV-10). Every field may be
 * left out, and a field left out keeps its saved value: no create default
 * (To Do, Medium) is applied, so a request that does not mention the status
 * cannot reset it, and a control that was absent from the form cannot erase
 * what it would have shown. Clearing is explicit — `""` or `null`. A field
 * that is sent is validated exactly as on create. The edit form sends every
 * field, so for it nothing changes; the API's PATCH now means what it says.
 * Unknown keys (`companyId`, `completedAt`, `version`…) are stripped, never
 * written (PRD #11 §116).
 */
export const updateTaskSchema = scheduleRefinement(
  z.object({
    title: title.optional(),
    description: patchText(TASK_DESCRIPTION_MAX),
    projectId: patchId,
    assigneeMemberId: patchId,
    status: z.enum(EDITABLE_STATUSES as [string, ...string[]], { message: "Choose a status." }).optional(),
    priority: z.enum(PRIORITIES, { message: "Choose a priority." }).optional(),
    startDate: patchDate,
    dueDate: patchDate,
    expectedVersion,
  }),
);

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** The dedicated status endpoints (PRD #11 §66–§70, §113): each names the version it acts on. */
export const taskCommandSchema = z.object({ expectedVersion });

/** Mark blocked: the reason is checked by the command itself, identically for every transport. */
export const blockTaskSchema = z.object({ expectedVersion, reason: z.string().optional() });

export const reopenTaskSchema = z.object({
  expectedVersion,
  status: optionalEnum(REOPEN_STATUSES as unknown as [string, ...string[]]),
});

export type ReopenTaskInput = z.infer<typeof reopenTaskSchema>;

export const TASK_SORT_KEYS = [
  "due-asc",
  "due-desc",
  "priority-desc",
  "priority-asc",
  "updated-desc",
  "created-desc",
  "title-asc",
  "title-desc",
] as const;

export type TaskSortKey = (typeof TASK_SORT_KEYS)[number];

/** Due-date presets offered by the list toolbar (PRD #11 §38). */
export const TASK_DUE_FILTERS = ["overdue", "today", "week", "next7", "none"] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

export const taskListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"])).optional(),
  priority: z.array(z.enum(PRIORITIES)).optional(),
  projectId: z.string().optional(),
  assigneeMemberId: z.string().optional(),
  createdByMemberId: z.string().optional(),
  /**
   * The record a task was raised from (PRD #11 §55, PRD #17 §135, §138).
   *
   * A module that files tasks against its own records — Sales against a lead or
   * an opportunity — narrows the canonical list with these rather than keeping
   * a task table of its own. They filter; they never widen: the task scope
   * clause still decides which rows are reachable.
   */
  moduleKey: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  due: z.enum(TASK_DUE_FILTERS).optional(),
  dueFrom: optionalDate,
  dueTo: optionalDate,
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(TASK_SORT_KEYS).default("due-asc"),
  /** Archived tasks live in their own section (PRD #11 §30). */
  archived: z.boolean().default(false),
  /** Tasks assigned to the current member (PRD #11 §26). */
  mine: z.boolean().default(false),
  /** Only tasks that are still open — used by the Overdue section. */
  openOnly: z.boolean().default(false),
  /** Only completed tasks (PRD #11 §29). */
  completedOnly: z.boolean().default(false),
  /**
   * A refinement of the Group workspace's list to one company (Workspace
   * Context §86, §87): a filter, never the workspace. It is checked against the
   * companies the person may read there, and a company workspace ignores it.
   */
  company: z.string().trim().max(64).optional(),
});

export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
