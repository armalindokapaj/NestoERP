import { z } from "zod";

import { dateOnlyToUtc, parseDateOnly } from "@/lib/forms/dates";

import { PROJECT_TYPE_NAME_MAX } from "@/config/project-types";
import { WORKING_STATUSES } from "./project.machine";

/**
 * Project validation (PRD #10 §193–§195).
 *
 * The same schemas run on the form and in the service. The frontend copy exists
 * for the person filling in the form; the backend copy is the authority
 * (PRD #7 §43).
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

/** A published built area in m² (D-01 §16): above nothing, at most ten million. */
const optionalArea = z
  .union([z.coerce.number().positive("Built area must be above zero").max(10_000_000, "Built area is at most 10,000,000 m²"), z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : (value as number)));

/**
 * A real calendar day, `YYYY-MM-DD`, between 1900 and 2199 (AUD-09 §4, FV-07):
 * the shared rule, `lib/forms/dates`. `new Date("2026-02-30")` rolls over to
 * 2 March, and `z.coerce.date()` accepts "1" as 2001: both would store a day
 * the person never chose.
 */
function isCalendarDay(value: string): boolean {
  return parseDateOnly(value).ok;
}

/**
 * A project date: a calendar day (UTC midnight, as `z.coerce.date()` stored
 * it), a full ISO timestamp, or a Date. Nothing else is guessed at.
 *
 * The day itself is read by `lib/forms/dates`; the omit/clear/set zod
 * fragments below stay here because `lib/forms/normalize` is a spec-driven
 * normalizer, not a zod schema (AUD-09: candidate for lib/forms).
 */
const projectDate = z.union([
  z.date(),
  z
    .string()
    .trim()
    .refine((value) => isCalendarDay(value) || z.string().datetime({ offset: true }).safeParse(value).success, {
      message: "Enter a real date as YYYY-MM-DD.",
    })
    .transform((value) => isCalendarDay(value) ? dateOnlyToUtc(value) : new Date(value)),
]);

const optionalDate = z
  .union([projectDate, z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : (value as Date)));

/** The optimistic-concurrency stamp: any instant, as before. */
const versionStamp = z
  .union([z.coerce.date(), z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : (value as Date)));

/*
 * Update-only fields (AUD-09 §4, FV-05): absent keeps the saved value, `""` or
 * `null` clears it, a value replaces it.
 *
 * AUD-09: candidate for lib/forms (the omit / clear / set triple).
 */
const patchText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value));

const patchId = z
  .union([z.string().trim().max(64), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value));

const patchDate = z
  .union([projectDate, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : (value as Date)));

const patchArea = z
  .union([
    z.coerce.number({ message: "Built area must be a number" }).positive("Built area must be above zero").max(10_000_000, "Built area is at most 10,000,000 m²"),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : (value as number)));

/**
 * An unset `<select>` submits an empty string, not an absent key. Treating that
 * as "no value" rather than an invalid enum member is what lets a form be
 * submitted with an optional dropdown left alone.
 */
function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.literal("")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : (value as T[number])));
}

const projectFields = {
  code: z
    .string()
    .trim()
    .min(1, "Project code is required")
    .max(50, "Project code must be 50 characters or fewer"),
  name: z
    .string()
    .trim()
    .min(2, "Project name must be at least 2 characters")
    .max(160, "Project name must be 160 characters or fewer"),
  description: optionalText(5000),
  clientId: optionalId,
  projectManagerMemberId: optionalId,
  priority: optionalEnum(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const),
  /** One of the company's own project types; the service checks it is theirs and in use (E-05A §62). */
  projectTypeId: optionalId,
  startDate: optionalDate,
  endDate: optionalDate,
  address: optionalText(300),
  city: optionalText(120),
  country: optionalText(120),
  builtArea: optionalArea,
  /** Shown among the group's key projects (D-01 §31). A select, so an untouched form never clears it. */
  isKeyProject: optionalEnum(["YES", "NO"] as const),
};

/** End date must never precede start date (PRD #10 §38). */
const scheduleRefinement = <T extends { startDate?: Date | null; endDate?: Date | null }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate.getTime() <= value.endDate.getTime(),
    { message: "End date must be on or after the start date.", path: ["endDate"] },
  );

export const createProjectSchema = scheduleRefinement(
  z.object({
    ...projectFields,
    /**
     * The company the project is created in (E-05A §30, §39). Optional: absent
     * means the company the session is in. Whatever arrives, the service checks
     * `project.create` in that company for this person — naming a company is a
     * request, never a grant.
     */
    companyId: z
      .string()
      .trim()
      .max(64)
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    /** Required on a new project (E-05A §13); an older project may still have none. */
    projectTypeId: z.string().trim().min(1, "Choose a project type").max(64),
    /** New projects start Pending unless an authorised person says otherwise (E-05A §31). */
    status: z.enum(WORKING_STATUSES).default("PENDING"),
  }),
);

/**
 * A project edit is a partial update (AUD-09 §4, FV-05, FV-10): a field left
 * out keeps its saved value, `""`/`null` clears an optional one, and a field
 * that is sent is validated as on create. The edit form sends every field, so
 * for it nothing changes; a PATCH that names only the city no longer erases
 * the description, client, manager, dates and location. Unknown keys are
 * stripped (PRD #10 §116).
 */
export const updateProjectSchema = scheduleRefinement(
  z.object({
    code: projectFields.code.optional(),
    name: projectFields.name.optional(),
    description: patchText(5000),
    clientId: patchId,
    projectManagerMemberId: patchId,
    priority: z
      .union([z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value)),
    projectTypeId: patchId,
    startDate: patchDate,
    endDate: patchDate,
    address: patchText(300),
    city: patchText(120),
    country: patchText(120),
    builtArea: patchArea,
    isKeyProject: projectFields.isKeyProject,
    /**
     * Absent leaves the status where it is. A different status is a move on the
     * project machine and needs `project.status.manage` (E-05A §11) — editing
     * the details does not carry it.
     */
    status: z.enum(WORKING_STATUSES).optional(),
    /**
     * The cover render (E-05A §8). Absent leaves it; an empty string clears it;
     * an id must name an image document on this project the editor can open.
     */
    coverImageDocumentId: z.string().trim().max(64).optional(),
    /**
     * Optimistic concurrency: the value the form was loaded with. If the record
     * has moved on since, the update is refused rather than silently
     * overwriting somebody else's edit (PRD #10 §178).
     */
    versionUpdatedAt: versionStamp,
  }),
);

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const PROJECT_SORT_KEYS = [
  "updated-desc",
  "created-desc",
  "name-asc",
  "name-desc",
  "start-asc",
  "end-asc",
  "priority-desc",
  "status-asc",
] as const;

export type ProjectSortKey = (typeof PROJECT_SORT_KEYS)[number];

export const projectListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(WORKING_STATUSES)).optional(),
  priority: z.array(z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])).optional(),
  clientId: z.string().optional(),
  projectManagerMemberId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(PROJECT_SORT_KEYS).default("updated-desc"),
  /** Archived projects live in their own section (PRD #10 §29). */
  archived: z.boolean().default(false),
  /** Projects the current member manages or belongs to (PRD #10 §100). */
  mine: z.boolean().default(false),
});

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const addProjectMemberSchema = z.object({
  companyMemberId: z.string().trim().min(1, "Select a team member"),
  projectRole: optionalText(120),
});

export const updateProjectMemberSchema = z.object({
  projectRole: optionalText(120),
  isPrimary: z.boolean().optional(),
});

export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberSchema>;

/* -------------------------------------------------------------------------- */
/* Projects page (E-05A)                                                       */
/* -------------------------------------------------------------------------- */

export const PORTFOLIO_PAGE_SIZE = 24;

/**
 * The query behind the Projects page and `GET /api/projects` (Projects
 * Workspace Grid §21-§23, §107, §108).
 *
 * The workspace decides which companies, and the person's own access decides
 * which projects; neither comes from the URL. A search is the one thing a
 * request adds, and it only narrows that set. There is no sort, filter or view:
 * the order is fixed (§34-§36).
 */
export const portfolioQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(60).default(PORTFOLIO_PAGE_SIZE),
});

export type PortfolioQuery = z.infer<typeof portfolioQuerySchema>;

/** `PATCH /api/projects/:id/status` (E-05A §40). */
export const changeProjectStatusSchema = z.object({
  status: z.enum(WORKING_STATUSES),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

export type ChangeProjectStatusInput = { status: z.infer<typeof changeProjectStatusSchema>["status"]; reason?: string };

/* -------------------------------------------------------------------------- */
/* Project types (E-05A §30, §62)                                              */
/* -------------------------------------------------------------------------- */

const projectTypeName = z
  .string()
  .trim()
  .min(1, "Give the type a name")
  .max(PROJECT_TYPE_NAME_MAX, `Keep the name under ${PROJECT_TYPE_NAME_MAX} characters`);

export const createProjectTypeSchema = z.object({ name: projectTypeName });

/** Rename, retire or bring back. Absent leaves a field as it is. */
export const updateProjectTypeSchema = z
  .object({ name: projectTypeName.optional(), isActive: z.boolean().optional() })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, { message: "Nothing to change" });

/** Every one of the company's types, in the order the list should show them. */
export const reorderProjectTypesSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200) });

export type CreateProjectTypeInput = z.infer<typeof createProjectTypeSchema>;
export type UpdateProjectTypeInput = z.infer<typeof updateProjectTypeSchema>;
