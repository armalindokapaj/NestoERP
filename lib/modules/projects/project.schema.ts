import { z } from "zod";

import { EDITABLE_STATUSES } from "./project.status";

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

const optionalDate = z
  .union([z.coerce.date(), z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : (value as Date)));

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
  status: z.enum(EDITABLE_STATUSES as [string, ...string[]]),
  priority: optionalEnum(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const),
  startDate: optionalDate,
  endDate: optionalDate,
  address: optionalText(300),
  city: optionalText(120),
  country: optionalText(120),
};

/** End date must never precede start date (PRD #10 §38). */
const scheduleRefinement = <T extends { startDate?: Date; endDate?: Date }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate.getTime() <= value.endDate.getTime(),
    { message: "End date must be on or after the start date.", path: ["endDate"] },
  );

export const createProjectSchema = scheduleRefinement(z.object(projectFields));

export const updateProjectSchema = scheduleRefinement(
  z.object({
    ...projectFields,
    /**
     * Optimistic concurrency: the value the form was loaded with. If the record
     * has moved on since, the update is refused rather than silently
     * overwriting somebody else's edit (PRD #10 §178).
     */
    versionUpdatedAt: optionalDate,
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
  status: z.array(z.enum(["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED"])).optional(),
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
