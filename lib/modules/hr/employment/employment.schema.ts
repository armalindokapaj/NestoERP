import { z } from "zod";

import { optionalId, optionalText } from "@/lib/modules/shared/fields";
import { isDay } from "./employment.dates";
import { POSITION_REASONS, STATUS_CHANGE_REASONS, TERMINATION_REASONS } from "./employment.labels";

/**
 * Employment changes (E-03 §36, §37, §74, §78, §79).
 *
 * One typed change per semantic action, never a PATCH of organization fields.
 * `companyId`, the employment, every actor and the history rows' own ids are
 * absent: the server takes the company from the session and the employment from
 * the route, and records who acted (§79). `targetCompanyId` names where a
 * transfer goes, and is checked against the group and the actor's authority
 * there.
 */

export const WORK_LOCATION_TYPES = ["OFFICE", "SITE", "REMOTE", "HYBRID", "OTHER"] as const;
const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN", "TEMPORARY", "OTHER"] as const;

export const day = z.string().trim().refine(isDay, "Enter a date as YYYY-MM-DD.");

/** A manager to change to: an id, or `null`/"" for nobody. Absent means unchanged. */
const managerChange = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" ? null : value));

const jobTitle = z.string().trim().min(1, "Enter the job title").max(120, "Job titles are 120 characters or fewer");

const common = {
  effectiveDate: day,
  /** A canonical document the change rests on, referenced, never copied (§45-§49). */
  documentId: optionalId,
  /** HR's own note on the change; never shown to the employee (§128). */
  note: optionalText(2000),
  /** The current assignment the form was built on; a stale one is refused (§40, §248). */
  expectedAssignmentId: optionalId,
};

const location = {
  workLocationType: z.union([z.enum(WORK_LOCATION_TYPES), z.literal("")]).optional().transform((value) => (value === "" ? undefined : value)),
  workLocation: optionalText(160),
};

export const employmentChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("POSITION"), ...common, jobTitle, reason: z.enum(POSITION_REASONS), departmentId: optionalId, managerMemberId: managerChange }),
  z.object({ action: z.literal("DEPARTMENT"), ...common, departmentId: z.string().trim().min(1, "Choose the department"), managerMemberId: managerChange, ...location }),
  z.object({
    action: z.literal("MANAGER"),
    ...common,
    managerMemberId: z.union([z.string().trim(), z.null()]).transform((value) => (value === "" ? null : value)),
  }),
  z.object({ action: z.literal("LOCATION"), ...common, workLocationType: z.enum(WORK_LOCATION_TYPES, { message: "Choose where they work" }), workLocation: optionalText(160) }),
  z.object({ action: z.literal("EMPLOYMENT_TYPE"), ...common, employmentType: z.enum(EMPLOYMENT_TYPES, { message: "Choose an employment type" }) }),
  z.object({
    action: z.literal("STATUS"),
    ...common,
    status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED"]),
    reason: z.enum([...STATUS_CHANGE_REASONS, "HIRE"]).optional(),
    privateReason: optionalText(2000),
  }),
  z.object({
    action: z.literal("TERMINATE"),
    documentId: optionalId,
    note: optionalText(2000),
    expectedAssignmentId: optionalId,
    /** The last day worked; employment has ended from the day after (§91, §104). */
    lastWorkingDay: day,
    reason: z.enum(TERMINATION_REASONS),
    privateReason: optionalText(2000),
  }),
  z.object({
    action: z.literal("REHIRE"),
    ...common,
    jobTitle: jobTitle.optional(),
    departmentId: optionalId,
    managerMemberId: managerChange,
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    ...location,
  }),
  z.object({
    action: z.literal("LEGAL_ENTITY"),
    ...common,
    targetCompanyId: z.string().trim().min(1, "Choose the company"),
    departmentId: z.string().trim().min(1, "Choose the department"),
    jobTitle,
    managerMemberId: managerChange,
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    ...location,
  }),
]);

export type EmploymentChangeInput = z.infer<typeof employmentChangeSchema>;
export type EmploymentChangeAction = EmploymentChangeInput["action"];

/**
 * A correction of one history row (E-03 §42-§44, §76, §171, §224): what it
 * should have said, and why. The original stays, superseded; the corrected row
 * names it. Moving a start date moves the end of the row before it.
 */
export const correctionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ASSIGNMENT"),
    rowId: z.string().trim().min(1),
    correctionReason: z.string().trim().min(3, "Say why the history is being corrected").max(2000),
    startDate: day.optional(),
    departmentId: z.union([z.string().trim(), z.null()]).optional().transform((value) => (value === "" ? null : value)),
    jobTitle: z.union([jobTitle, z.null()]).optional(),
    managerMemberId: managerChange,
    workLocationType: z.union([z.enum(WORK_LOCATION_TYPES), z.null()]).optional(),
    workLocation: z.union([z.string().trim().max(160), z.null()]).optional().transform((value) => (value === "" ? null : value)),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    reason: z.enum(["HIRE", "REHIRE", "PROMOTION", "DEMOTION", "TITLE_CHANGE", "DEPARTMENT_TRANSFER", "LEGAL_ENTITY_TRANSFER", "MANAGER_CHANGE", "LOCATION_CHANGE", "EMPLOYMENT_TYPE_CHANGE", "REORGANIZATION", "OTHER"]).optional(),
    documentId: z.union([z.string().trim(), z.null()]).optional().transform((value) => (value === "" ? null : value)),
  }),
  z.object({
    kind: z.literal("STATUS"),
    rowId: z.string().trim().min(1),
    correctionReason: z.string().trim().min(3, "Say why the history is being corrected").max(2000),
    effectiveFrom: day.optional(),
    reason: z.enum(["HIRE", "REHIRE", "LEAVE", "RETURN", "SUSPENSION", "RESIGNATION", "DISMISSAL", "END_OF_CONTRACT", "RETIREMENT", "MUTUAL_AGREEMENT", "LEGAL_ENTITY_TRANSFER", "OTHER"]).optional(),
    privateReason: z.union([z.string().trim().max(2000), z.null()]).optional().transform((value) => (value === "" ? null : value)),
    documentId: z.union([z.string().trim(), z.null()]).optional().transform((value) => (value === "" ? null : value)),
  }),
]);

export type CorrectionInput = z.infer<typeof correctionSchema>;

export const cancelScheduledChangeSchema = z.object({
  reason: optionalText(500),
});

/** Organization reporting (E-03 §141-§144): a day to count on, and a period for movements. */
export const organizationReportQuerySchema = z.object({
  asOf: day.optional(),
  from: day.optional(),
  to: day.optional(),
});

export type OrganizationReportQuery = z.infer<typeof organizationReportQuerySchema>;
