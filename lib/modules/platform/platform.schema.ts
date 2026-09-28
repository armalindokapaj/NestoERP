import { z } from "zod";

import { MODULE_KEYS } from "@/config/modules";
import { MEMBERSHIP_ROLE_KEYS } from "@/config/roles";
import { unset } from "@/lib/modules/hr/recruitment/candidate.schema";
import { optionalText, requiredText } from "@/lib/modules/shared/fields";

/**
 * Platform implementation validation (E-06 §20, §21, §34, §35, §69, §70, §86, §87).
 *
 * Nothing here names a company a request may act on through its body: the
 * group comes from the URL and is checked against the platform, the company
 * from its own slug.
 */

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "Use lowercase letters, digits and hyphens");

export const createParentGroupSchema = z.object({
  name: requiredText(2, 120, "Name"),
  slug,
  legalName: unset(optionalText(200)),
  country: unset(optionalText(80)),
  timezone: unset(optionalText(64)),
  currency: unset(z.string().trim().length(3).toUpperCase().optional()),
});
export type CreateParentGroupInput = z.infer<typeof createParentGroupSchema>;

export const updateParentGroupSchema = createParentGroupSchema.omit({ slug: true });
export type UpdateParentGroupInput = z.infer<typeof updateParentGroupSchema>;

export const createGroupCompanySchema = z.object({
  name: requiredText(2, 120, "Name"),
  slug,
  legalName: unset(optionalText(200)),
  // The company is the employing legal entity (E-01 §28, ADR 0002).
  registrationNumber: unset(optionalText(60)),
  taxNumber: unset(optionalText(60)),
  industry: unset(optionalText(120)),
  country: unset(optionalText(80)),
  address: unset(optionalText(300)),
  email: unset(z.email("Enter a valid email address").optional()),
  phone: unset(optionalText(40)),
  website: unset(optionalText(200)),
  disabledModules: z.array(z.enum(MODULE_KEYS)).default([]),
  /**
   * The group departments the company runs (E-13 §48, §49, §75, §121): a
   * branch of each is created, and of nothing else. Left out, every active one.
   */
  departmentIds: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
});
export type CreateGroupCompanyInput = z.infer<typeof createGroupCompanySchema>;

/** The Owner and Group IT hold a membership in every company of the group; everyone else in the ones named. */
export const GROUP_LEVEL_ROLES = ["OWNER", "GROUP_IT"] as const;

export const initialUserSchema = z.object({
  firstName: requiredText(1, 80, "First name"),
  lastName: requiredText(1, 80, "Last name"),
  workEmail: unset(z.email("Enter a valid email address").optional()),
  username: unset(optionalText(64)),
  roleKey: z.enum(MEMBERSHIP_ROLE_KEYS as [string, ...string[]]),
  /** Ignored for the Owner and Group IT, who work in every company. */
  companyIds: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  jobTitle: unset(optionalText(120)),
  position: z.enum(["MEMBER", "COMPANY_MANAGER", "GROUP_HEAD"]).default("MEMBER"),
});
export type InitialUserInput = z.infer<typeof initialUserSchema>;

export const initialProjectMemberSchema = z.object({
  projectId: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(64),
  projectRole: unset(optionalText(120)),
});
export type InitialProjectMemberInput = z.infer<typeof initialProjectMemberSchema>;

/**
 * A new company needs only its name (Simplified Company Creation §2, §10). Its
 * code is derived from the name; everything else is completed later.
 */
export const createCompanySchema = z.object({
  name: requiredText(2, 120, "Company name"),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** Attaching a standalone company to a Parent Group (§6), and detaching it (§7). */
export const attachCompanySchema = z.object({
  groupId: z.string().trim().min(1).max(128),
  reason: requiredText(3, 500, "Reason"),
});
export const detachCompanySchema = z.object({
  reason: requiredText(3, 500, "Reason"),
});
