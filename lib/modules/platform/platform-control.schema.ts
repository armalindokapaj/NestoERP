import { z } from "zod";

import { MODULE_KEYS } from "@/config/modules";
import { PERMISSIONS } from "@/config/permissions";
import { MEMBERSHIP_ROLE_KEYS } from "@/config/roles";
import { isShellLogoSource, LOGO_DATA_URI_MAX } from "@/lib/workspace/branding";

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(3, "Give a reason for this action.").max(500);
const optionalText = (max: number) => z.string().trim().max(max).optional();
/**
 * A tenant logo (OW §12, §44): a path on this deployment or a small inline
 * image, the only sources the shell's content security policy lets it draw.
 * Empty clears it, and the shell shows initials.
 */
const logoSource = z
  .string()
  .trim()
  .max(LOGO_DATA_URI_MAX)
  .refine((value) => value === "" || isShellLogoSource(value), "Use a path on this deployment (for example /branding/logo.svg) or an inline image (data:image/png;base64,…).");

export const groupStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]),
  reason,
});

export const companyStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]),
  reason,
});

export const groupBrandingSchema = z.object({
  logoUrl: logoSource,
  reason,
});

export const companyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  logoUrl: logoSource.optional(),
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

/**
 * Optional person text: absent, empty or null (AUD-09 §4, FV-05). The dialog
 * sends null for a blank field, which the schema used to refuse, so every
 * person with a blank preferred name could not be saved. On an edit absent
 * keeps the stored value; empty or null clears it.
 */
const personText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));

export const personCreateSchema = z.object({
  parentGroupId: id,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  preferredName: personText(120),
  jobTitle: personText(120),
  workEmail: z
    .union([z.string().trim().email("Enter a valid email address."), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
  workPhone: personText(40),
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

/** A name and a managing company are enough (Admin Projects & 3D PRD #5 §10); the code is made from the name. */
export const projectCreateSchema = z.object({
  /** Optional: no company creates an unassigned project (Standalone Project PRD §5, §7). */
  companyId: z.preprocess((value) => (value === "" || value === null ? undefined : value), id.optional()),
  code: z.preprocess((value) => (value === "" || value === null ? undefined : value), z.string().trim().min(1).max(30).optional()),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(["PENDING", "ACTIVE", "FINISHED"]).default("PENDING"),
  reason: z.preprocess((value) => (value === "" || value === null ? undefined : value), reason.optional()),
});

export const projectAssignSchema = z.object({
  projectId: id,
  companyId: id,
  reason: z.preprocess((value) => (value === "" || value === null ? undefined : value), reason.optional()),
});

export const projectAssignPreviewSchema = z.object({ projectId: id, companyId: id });

export const projectUpdateSchema = z.object({
  projectId: id,
  name: z.string().trim().min(2).max(160),
  description: z.preprocess((value) => (value === "" ? null : value), z.string().trim().max(2000).nullable().optional()),
  status: z.enum(["PENDING", "ACTIVE", "FINISHED"]),
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

/** Platform Recovery: delete and permanent removal need the name typed back; restore needs only a reason. */
export const tenantDeleteSchema = z.object({ reason, confirmationName: z.string().trim().min(1, "Type the name to confirm.").max(200) });
export const tenantRestoreSchema = z.object({ reason });
