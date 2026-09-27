import { z } from "zod";

import { MEMBERSHIP_ROLE_KEYS } from "@/config/roles";
import { optionalDate, optionalEnum, optionalId, optionalText, requiredText } from "@/lib/modules/shared/fields";
import { clearable, EMPLOYMENT_TYPES } from "../hr.schema";

/**
 * A form sends an empty optional field as null; for these inputs null and
 * absent mean the same thing, "not given".
 */
export const unset = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === null ? undefined : value), schema);

/**
 * Recruitment validation (E-06 §22-§24, §91).
 *
 * The group, the person's lifecycle, the candidate's status and every decision
 * field are absent: they are the server's. A person is identified by the group
 * they are recruited into and by nothing a browser sends.
 */

/** Roles a candidate can be recruited into. The Owner is appointed, never hired (§39). */
export const RECRUITABLE_ROLE_KEYS = MEMBERSHIP_ROLE_KEYS.filter((key) => key !== "OWNER") as [string, ...string[]];

export const CANDIDATE_STATUSES = ["INTERVIEWING", "SELECTED", "OFFERED", "HIRED", "REJECTED", "WITHDRAWN"] as const;

const email = unset(
  z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((value) => (value === "" ? undefined : value?.toLowerCase()))
    .pipe(z.email("Enter a valid email address").optional()),
);

const personFields = {
  firstName: requiredText(1, 80, "First name"),
  lastName: requiredText(1, 80, "Last name"),
  preferredName: unset(optionalText(80)),
  workEmail: email,
  workPhone: unset(optionalText(40)),
  personalEmail: email,
  personalPhone: unset(optionalText(40)),
  city: unset(optionalText(120)),
  country: unset(optionalText(120)),
};

const targetFields = {
  targetCompanyId: unset(optionalId),
  targetDepartmentId: unset(optionalId),
  targetRoleKey: unset(optionalEnum(RECRUITABLE_ROLE_KEYS)),
  targetJobTitle: unset(optionalText(120)),
  hiringManagerUserId: unset(optionalId),
  interviewStage: unset(optionalText(120)),
  notes: unset(optionalText(4000)),
};

export const createCandidateSchema = z.object({ ...personFields, ...targetFields });
export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;

const plainEmail = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase())
  .pipe(z.email("Enter a valid email address"));

/**
 * An edit: every optional field is absent (unchanged), empty or null
 * (cleared), or a value (AUD-09 §4, FV-05). The dialog does not carry every
 * field of the person — a preferred name set elsewhere — and a PATCH may name
 * one field; neither erases the rest, and neither moves the candidate to the
 * editor's own company.
 */
export const updateCandidateSchema = z.object({
  firstName: personFields.firstName,
  lastName: personFields.lastName,
  preferredName: clearable(z.string().trim().max(80)),
  workEmail: clearable(plainEmail),
  workPhone: clearable(z.string().trim().max(40)),
  personalEmail: clearable(plainEmail),
  personalPhone: clearable(z.string().trim().max(40)),
  city: clearable(z.string().trim().max(120)),
  country: clearable(z.string().trim().max(120)),
  targetCompanyId: clearable(z.string().trim().max(64)),
  targetDepartmentId: clearable(z.string().trim().max(64)),
  targetRoleKey: clearable(z.enum(RECRUITABLE_ROLE_KEYS)),
  targetJobTitle: clearable(z.string().trim().max(120)),
  hiringManagerUserId: clearable(z.string().trim().max(64)),
  interviewStage: clearable(z.string().trim().max(120)),
  notes: clearable(z.string().trim().max(4000)),
});
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;

export const hireCandidateSchema = z.object({
  employeeNumber: unset(optionalText(40)),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
  startDate: unset(optionalDate),
});
export type HireCandidateInput = z.infer<typeof hireCandidateSchema>;

export const candidateDecisionSchema = z.object({ note: unset(optionalText(1000)) });

export const candidateListQuerySchema = z.object({
  status: optionalEnum(CANDIDATE_STATUSES),
  q: optionalText(120),
  // A page that is not a page number is page 1, not an error page (AUD-08 §3).
  page: z.coerce.number().int().min(1).default(1).catch(1),
});
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;
