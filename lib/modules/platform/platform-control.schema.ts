import { z } from "zod";

import { MODULE_KEYS } from "@/config/modules";
import { PERMISSIONS } from "@/config/permissions";
import { MEMBERSHIP_ROLE_KEYS } from "@/config/roles";

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(3, "Give a reason for this action.").max(500);
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const groupStatusSchema = z.object({
  status: z.enum(["IMPLEMENTING", "READY_FOR_VALIDATION", "ACTIVE", "SUSPENDED", "ARCHIVED"]),
  reason,
});

export const companyStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]),
  reason,
});

export const companyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: optionalText(200),
  registrationNumber: optionalText(60),
  taxNumber: optionalText(60),
  industry: optionalText(120),
  country: optionalText(80),
  address: optionalText(300),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  phone: optionalText(40),
  website: optionalText(200),
  reason,
});

export const personCreateSchema = z.object({
  parentGroupId: id,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  preferredName: optionalText(120),
  jobTitle: optionalText(120),
  workEmail: z.union([z.string().trim().email(), z.literal("")]).optional(),
  workPhone: optionalText(40),
  lifecycleStatus: z.enum(["CANDIDATE", "SELECTED", "EMPLOYEE", "FORMER_EMPLOYEE"]).default("EMPLOYEE"),
  reason,
});

export const personUpdateSchema = personCreateSchema.omit({ parentGroupId: true }).partial().required({ firstName: true, lastName: true, lifecycleStatus: true, reason: true });

export const platformUserCreateSchema = z.object({
  personProfileId: id,
  username: optionalText(32),
  reason,
});

export const userStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]),
  reason,
});

export const membershipSchema = z.object({
  userId: id,
  companyId: id,
  roleKey: z.enum(MEMBERSHIP_ROLE_KEYS as [string, ...string[]]),
  status: z.enum(["ACTIVE", "INVITED", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
  jobTitle: z.string().trim().max(120).optional(),
  reason,
});

export const membershipUpdateSchema = z.object({
  roleKey: z.enum(MEMBERSHIP_ROLE_KEYS as [string, ...string[]]).optional(),
  status: z.enum(["ACTIVE", "INVITED", "INACTIVE", "SUSPENDED"]).optional(),
  reason,
}).refine((value) => value.roleKey !== undefined || value.status !== undefined, "Choose a role or status.");

export const sessionRevokeSchema = z.object({ reason });

export const moduleToggleSchema = z.object({
  companyId: id,
  moduleKey: z.enum(MODULE_KEYS),
  enabled: z.boolean(),
  reason,
});

export const featureFlagSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,63}$/, "Use lowercase letters, numbers and underscores."),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  defaultState: z.enum(["OFF", "ON", "BETA"]).default("OFF"),
  reason,
});

export const featureFlagOverrideSchema = z.object({
  scopeType: z.enum(["PLATFORM", "GROUP", "COMPANY", "USER"]),
  scopeId: id,
  state: z.enum(["OFF", "ON", "BETA"]),
  reason,
});

export const accessInspectorSchema = z.object({
  userId: id,
  companyId: id,
  projectId: id.optional(),
  permission: z.enum(PERMISSIONS as unknown as [string, ...string[]]),
});

export const platformGrantSchema = z.object({
  userId: id,
  parentGroupId: id,
  moduleKey: z.enum(MODULE_KEYS),
  scopeType: z.enum(["GROUP", "COMPANY", "PROJECT"]),
  scopeId: id,
  accessLevel: z.enum(["VIEW", "CONTRIBUTE", "APPROVE", "MANAGE"]),
  expiresAt: z.coerce.date().optional(),
  reason,
});

export const grantRevokeSchema = z.object({ reason });
export const membershipRepairSchema = z.object({ membershipId: id, reason });

export const projectCreateSchema = z.object({
  companyId: id,
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(["PENDING", "ACTIVE", "FINISHED"]).default("PENDING"),
  reason,
});

export const platformSettingSchema = z.object({
  key: z.enum([
    "general.platformName",
    "general.platformUrl",
    "general.supportContact",
    "localization.defaultLanguage",
    "localization.defaultCurrency",
    "localization.defaultTimezone",
    "branding.logoUrl",
    "branding.faviconUrl",
  ]),
  value: z.union([z.string().trim().max(500), z.boolean(), z.number().finite()]),
  reason,
});

export const maintenanceSettingSchema = z.object({
  key: z.enum([
    "maintenance.enabled",
    "maintenance.readOnly",
    "maintenance.disableUploads",
    "maintenance.disableNewLogins",
    "maintenance.disable3DProcessing",
  ]),
  enabled: z.boolean(),
  reason,
});

export const supportAccessSchema = z.object({
  parentGroupId: id.optional(),
  companyId: id.optional(),
  projectId: id.optional(),
  targetUserId: id.optional(),
  reason,
  durationMinutes: z.coerce.number().int().min(5).max(240).default(30),
}).refine((value) => Boolean(value.parentGroupId || value.companyId || value.projectId || value.targetUserId), "Choose a support target.");

export type AccessInspectorInput = z.infer<typeof accessInspectorSchema>;
