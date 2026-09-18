import { z } from "zod";

/**
 * What E-13's department requests may carry (§68-§75, §80-§83).
 *
 * The group is never a field: it is the session's own (E-06 §117). A company
 * is named only as the target of an activation or a filter, and every service
 * re-checks it against the group and the reader's reach.
 */

const id = z.string().trim().min(1).max(128);

const code = z
  .string()
  .trim()
  .min(2, "A code has at least two characters.")
  .max(12, "A code has at most twelve characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "A code uses letters, digits, hyphens and underscores.")
  .transform((value) => value.toUpperCase());

const name = z.string().trim().min(2, "Give the department a name.").max(80);
const description = z.string().trim().max(500);

export const createDepartmentSchema = z.object({
  name,
  code,
  description: description.optional().transform((value) => value || null),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

/** A field left out is left alone; an empty description is cleared. */
export const updateDepartmentSchema = z
  .object({
    name: name.optional(),
    code: code.optional(),
    description: z.union([description, z.null()]).optional().transform((value) => (value === undefined ? undefined : value || null)),
  })
  .refine((value) => value.name !== undefined || value.code !== undefined || value.description !== undefined, { message: "Change something first." });
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

/** Activate one department in several companies at once (E-13 §41, §42). */
export const activateCompaniesSchema = z.object({ companyIds: z.array(id).min(1).max(100) });
export type ActivateCompaniesInput = z.infer<typeof activateCompaniesSchema>;

/**
 * A head or a manager (E-13 §70, §71). Replacing the one in office has to be
 * asked for, so a second appointment is never an accident (§139).
 */
export const appointPersonSchema = z.object({ personId: id, replace: z.boolean().optional().default(false) });
export type AppointPersonInput = z.infer<typeof appointPersonSchema>;

export const addMemberSchema = z.object({ personId: id });
export type AddMemberInput = z.infer<typeof addMemberSchema>;

/** Moving a member's place to another company's branch of the same department (E-13 §72, §85). */
export const updateAssignmentSchema = z.object({ companyDepartmentId: id });
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const teamQuerySchema = z.object({
  company: id.optional(),
  position: z.enum(["GROUP_HEAD", "COMPANY_MANAGER", "MEMBER"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
  search: z.string().trim().max(80).optional().transform((value) => value || undefined),
});
export type TeamQuery = z.infer<typeof teamQuerySchema>;

export const candidatesQuerySchema = z.object({
  position: z.enum(["GROUP_HEAD", "COMPANY_MANAGER", "MEMBER"]),
  company: id.optional(),
  search: z.string().trim().max(80).optional().transform((value) => value || undefined),
});
export type CandidatesQuery = z.infer<typeof candidatesQuerySchema>;

export const departmentListQuerySchema = z.object({ status: z.enum(["ACTIVE", "ALL"]).default("ACTIVE") });
