import { z } from "zod";

import { optionalDate, optionalId, optionalText } from "@/lib/modules/shared/fields";
import { EDITABLE_DEPARTMENT_STATUSES } from "./membership.status";

/**
 * Team validation (PRD #14 §61, §154, §155, §156).
 *
 * `companyId`, `invitedByMemberId`, `tokenHash` and `status` are absent from
 * every input schema: they are server-controlled and must never be accepted
 * from the browser (PRD #14 §154, §155).
 */

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .max(254)
    .email("Enter a valid email address")
    .transform((value) => value.toLowerCase()),
  firstName: optionalText(120),
  lastName: optionalText(120),
  roleId: z.string().trim().min(1, "Choose a role"),
  departmentId: optionalId,
  jobTitle: optionalText(160),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * Membership fields only.
 *
 * A person's name, phone and avatar belong to their global `User` and are
 * edited in their own profile — a company manager does not rewrite somebody's
 * identity across every company they belong to (PRD #14 §86, §87).
 */
export const updateMemberSchema = z.object({
  jobTitle: optionalText(160),
  roleId: z.string().trim().min(1, "Choose a role"),
  departmentId: optionalId,
  versionUpdatedAt: optionalDate,
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** Accepting an invitation, for somebody who has no account yet (PRD #14 §74). */
export const acceptInviteSchema = z
  .object({
    token: z.string().trim().min(1),
    firstName: z.string().trim().min(1, "First name is required").max(120),
    lastName: z.string().trim().min(1, "Last name is required").max(120),
    password: z.string().min(12, "Use at least 12 characters").max(200),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  });

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const TEAM_SORT_KEYS = [
  "name-asc",
  "name-desc",
  "created-desc",
  "updated-desc",
  "role-asc",
  "department-asc",
  "last-login-desc",
] as const;

export type TeamSortKey = (typeof TEAM_SORT_KEYS)[number];

export const MEMBERSHIP_STATUSES = ["ACTIVE", "INVITED", "INACTIVE", "SUSPENDED"] as const;

export const teamListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  roleId: z.string().optional(),
  departmentId: z.string().optional(),
  status: z.array(z.enum(MEMBERSHIP_STATUSES)).optional(),
  projectId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(TEAM_SORT_KEYS).default("name-asc"),
});

export type TeamListQuery = z.infer<typeof teamListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Departments                                                                 */
/* -------------------------------------------------------------------------- */

export const departmentFields = {
  name: z
    .string()
    .trim()
    .min(2, "Department name must be at least 2 characters")
    .max(120, "Department name must be 120 characters or fewer"),
  key: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((value) => (value === "" ? undefined : value?.toLowerCase()))
    .refine((value) => !value || /^[a-z0-9][a-z0-9_-]*$/.test(value), {
      message: "Use lowercase letters, numbers, hyphens and underscores.",
    }),
  description: optionalText(2000),
  managerMemberId: optionalId,
  status: z.enum(EDITABLE_DEPARTMENT_STATUSES as [string, ...string[]]).default("ACTIVE"),
};

export const createDepartmentSchema = z.object(departmentFields);
export const updateDepartmentSchema = z.object({
  ...departmentFields,
  versionUpdatedAt: optionalDate,
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
