import { z } from "zod";

import { DEFAULT_LIMIT } from "@/lib/modules/shared/list-query";

/**
 * Inputs of the people directory and the work profile (E-01 §37-§40, §116,
 * §123-§125, §131-§136). Nothing here names a company, a group, a status of
 * verification or a permission: those come from the reader's context (§132).
 */

/** Absent leaves the field as it is; empty or null clears it. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value : null));

export const directoryQuerySchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  /** The company somebody works in, by id; one of the reader's group. */
  company: z.string().trim().max(64).optional().catch(undefined),
  /** The group department, by key (`finance`). */
  department: z.string().trim().max(40).optional().catch(undefined),
  title: z.string().trim().max(120).optional().catch(undefined),
  project: z.string().trim().max(64).optional().catch(undefined),
  location: z.string().trim().max(120).optional().catch(undefined),
  /** Who reports to this person (E-08 §41): a person id. */
  manager: z.string().trim().max(64).optional().catch(undefined),
  /** The NESTO role held in the group (§41), by key. */
  role: z.string().trim().max(40).optional().catch(undefined),
  /** A directory view (§11): the reader's own company, department or project colleagues. */
  view: z.enum(["company", "department", "projects"]).optional().catch(undefined),
  /** "all" includes people who no longer work here — for those who keep people's records. */
  status: z.enum(["active", "all"]).catch("active"),
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(50).catch(DEFAULT_LIMIT),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

/** What a person changes on their own profile (E-01 §53, E-08 §93). Name and phone stay the account's. */
export const ownWorkProfileSchema = z.object({
  preferredName: optionalText(80),
  workPhoneExtension: optionalText(20),
  officeLocation: optionalText(120),
  professionalBio: optionalText(1000),
});
export type OwnWorkProfileInput = z.infer<typeof ownWorkProfileSchema>;

/** What those who keep people's records change on somebody's work profile (E-01 §116, §133). */
export const managedWorkProfileSchema = z.object({
  preferredName: optionalText(80),
  jobTitle: optionalText(120),
  workEmail: z
    .union([z.literal("").transform(() => null), z.string().trim().max(200).email("Enter a valid email address.")])
    .nullable()
    .optional(),
  workPhoneExtension: optionalText(20),
  officeLocation: optionalText(120),
});
export type ManagedWorkProfileInput = z.infer<typeof managedWorkProfileSchema>;

/** Putting a person on a project from their profile (E-08 §49, §64). */
export const assignProjectSchema = z.object({
  projectId: z.string().trim().min(1, "Choose a project").max(64),
  projectRole: optionalText(120),
});
