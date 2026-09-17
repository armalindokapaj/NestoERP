import { z } from "zod";

import { optionalDate, optionalEnum, optionalId, optionalText } from "@/lib/modules/shared/fields";
import { RECRUITABLE_ROLE_KEYS, unset } from "@/lib/modules/hr/recruitment/candidate.schema";

/**
 * Account request validation (E-06 §27, §92, §93, §119).
 *
 * The group, the company, the person, the status and every decision field are
 * the server's: the company and the person come from the employment record the
 * request is for, and nobody sends who approved or provisioned it.
 */

export const PROVISIONING_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "IN_PROGRESS", "PROVISIONED", "REJECTED", "CANCELLED"] as const;

export const createProvisioningRequestSchema = z.object({
  employeeProfileId: z.string().trim().min(1).max(64),
  /** Defaults to what the hire confirmed; HR may correct it before submitting. */
  companyDepartmentId: unset(optionalId),
  functionalRoleKey: unset(optionalEnum(RECRUITABLE_ROLE_KEYS)),
  jobTitle: unset(optionalText(120)),
  managerUserId: unset(optionalId),
  requestedUsername: unset(optionalText(64)),
  requestedActivationDate: unset(optionalDate),
  notes: unset(optionalText(2000)),
  /** Submit straight away rather than keep a draft. */
  submit: z.boolean().optional().default(false),
});
export type CreateProvisioningRequestInput = z.infer<typeof createProvisioningRequestSchema>;

export const reasonSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason").max(1000),
});

export const provisionSchema = z.object({
  /** Group IT's only choice about the account (§29, §64): blank follows firstname.lastname. */
  username: unset(optionalText(64)),
});
export type ProvisionInput = { username?: string };

export const provisioningListQuerySchema = z.object({
  status: optionalEnum(PROVISIONING_STATUSES),
  page: z.coerce.number().int().min(1).default(1),
});
export type ProvisioningListQuery = z.infer<typeof provisioningListQuerySchema>;
