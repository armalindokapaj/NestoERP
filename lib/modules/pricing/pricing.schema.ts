import { z } from "zod";

const publicCount = (max: number) => z.number().int().min(0).max(max);
const cents = z.number().int().min(0).max(2_000_000_000);

const foundation = z.preprocess((value) => (value === "NESTO_ERP" ? "NESTO_PLATFORM" : value === "ROZARIS_ONLY" ? "ROZARIS" : value), z.enum(["NESTO_PLATFORM", "ROZARIS"]));
const rozarisClass = z.enum(["BASIC", "LARGE", "VILLAGE"]);
const moduleId = z.string().trim().regex(/^[A-Z0-9_]+$/).max(60);

export const pricingRequestSchema = z.object({
  foundation,
  modules: z.array(moduleId).max(60).default([]),
  companies: z.object({
    fullGroup: publicCount(500),
    jointVenture: publicCount(500),
    documentsOnly: publicCount(500),
  }).strict(),
  nestoProjects: z.object({ active: z.number().int().min(1).max(1_000) }).strict().optional(),
  rozarisProjects: z.array(z.object({ tempId: z.string().trim().min(1).max(40), type: rozarisClass }).strict()).max(50).default([]),
  activeUsers: z.number().int().min(1).max(100_000),
  contractMonths: z.union([z.literal(12), z.literal(24)]),
  promotionCode: z.string().trim().max(80).nullable().optional(),
}).strict().superRefine((input, context) => {
  if (input.foundation === "NESTO_PLATFORM" && !input.nestoProjects) {
    context.addIssue({ code: "custom", path: ["nestoProjects"], message: "NESTO Platform requires at least one active project." });
  }
});

export const calculatePricingRequestSchema = z.object({
  configuration: pricingRequestSchema,
  persistQuote: z.boolean().optional().default(false),
}).strict();

export const pricingLeadSchema = z.object({
  quoteId: z.string().trim().min(1).max(120),
  requestType: z.enum(["FORMAL_PROPOSAL", "TALK_TO_SALES", "THREE_D_PRODUCTION"]).default("FORMAL_PROPOSAL"),
  fullName: z.string().trim().min(2).max(160),
  companyName: z.string().trim().min(2).max(200),
  businessEmail: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(60).nullable().optional(),
  message: z.string().trim().max(2_000).nullable().optional(),
  consent: z.literal(true),
  website: z.string().max(0).optional(),
}).strict();

const indexationSchema = z.object({
  enabled: z.boolean(),
  source: z.string().trim().regex(/^EUROSTAT_HICP_[A-Z0-9_]+$/).max(120),
  floorPercent: z.number().int().min(0).max(100),
  capPercent: z.number().int().min(0).max(100),
  firstAdjustmentMonth: z.number().int().min(2).max(120),
}).strict().refine((value) => value.capPercent >= value.floorPercent, { message: "HICP cap must be at least the floor." });

/** The first price book shape, read and upgraded, never written again. */
export const legacyPricingConfigSchema = z.object({
  version: z.string().trim().min(4).max(30),
  currency: z.literal("EUR"),
  nestoERP: z.object({
    baseMonthlyCents: cents,
    includedCompanies: z.number().int().min(1).max(100),
    includedProjects: z.number().int().min(1).max(100),
    includedUsersPerFullCompany: z.number().int().min(1).max(10_000),
    additionalGroupCompanyMonthlyCents: cents,
    additionalJVCompanyMonthlyCents: cents,
    documentsOnlyCompanyMonthlyCents: cents,
    additionalProjectMonthlyCents: cents,
    userPackSize: z.number().int().min(1).max(10_000),
    userPackMonthlyCents: cents,
  }).strict(),
  rozaris: z.object({
    projectTypes: z.object({
      basic: z.object({ monthly24Cents: cents, monthly12Cents: cents }).strict(),
      large: z.object({ monthly24Cents: cents, monthly12Cents: cents }).strict(),
      village: z.object({ monthly24Cents: cents, monthly12Cents: cents }).strict(),
    }).strict(),
  }).strict(),
  indexation: indexationSchema,
}).strict();

const text = (max: number) => z.string().trim().max(max);
const foundationId = z.enum(["NESTO_PLATFORM", "ROZARIS"]);
const companyRules = z.object({
  included: z.number().int().min(1).max(100),
  additionalAvailable: z.boolean(),
  fullGroupMonthlyCents: cents,
  jointVentureMonthlyCents: cents,
  documentsOnlyMonthlyCents: cents,
  includedUsersPerFullCompany: z.number().int().min(0).max(10_000),
}).strict();
const rozarisClassRules = z.object({ name: text(60).min(2), guidance: text(400), monthly24Cents: cents, monthly12Cents: cents, includedUsers: z.number().int().min(0).max(10_000), imageKey: text(80).optional() }).strict();

export const pricingConfigSchema = z.object({
  schemaVersion: z.literal(2),
  version: z.string().trim().min(4).max(30),
  currency: z.literal("EUR"),
  foundations: z.array(z.object({
    id: foundationId, enabled: z.boolean(), name: text(80).min(2), description: text(400), baseMonthlyCents: cents,
    included: z.array(text(120)).max(30), imageKey: text(80).optional(),
  }).strict()).length(2),
  modules: z.array(z.object({
    id: moduleId, name: text(80).min(2), group: text(60).min(2), enabled: z.boolean(), public: z.boolean(),
    tier: z.enum(["S", "A", "B", "C", "ACCESS"]), monthlyPriceCents: cents,
    includedInFoundations: z.array(foundationId).max(2), lockedWhenIncluded: z.boolean(),
    dependencies: z.array(moduleId).max(20), conflicts: z.array(moduleId).max(20), absorbs: z.array(moduleId).max(20),
    shortDescription: text(200), description: text(800), imageKey: text(80).optional(), sortOrder: z.number().int().min(0).max(10_000),
  }).strict()).min(1).max(80),
  companies: z.object({ NESTO_PLATFORM: companyRules, ROZARIS: companyRules }).strict(),
  nestoProjects: z.object({ included: z.number().int().min(1).max(100), additionalMonthlyCents: cents }).strict(),
  nestoIncludedUsers: z.number().int().min(0).max(10_000),
  rozaris: z.object({
    classes: z.object({ BASIC: rozarisClassRules, LARGE: rozarisClassRules, VILLAGE: rozarisClassRules }).strict(),
    userAllowanceMode: z.enum(["MAX_PROJECT", "SUM_PROJECTS", "FIRST_PROJECT_ONLY"]),
  }).strict(),
  users: z.array(z.object({ foundation: foundationId, packSize: z.number().int().min(1).max(10_000), pricePerPackCents: cents }).strict()).length(2),
  indexation: indexationSchema,
}).strict().superRefine((config, context) => {
  const ids = new Set(config.modules.map((row) => row.id));
  if (ids.size !== config.modules.length) context.addIssue({ code: "custom", path: ["modules"], message: "Module ids must be unique." });
  config.modules.forEach((row, index) => {
    for (const key of ["dependencies", "conflicts", "absorbs"] as const) {
      for (const other of row[key]) if (!ids.has(other) || other === row.id) context.addIssue({ code: "custom", path: ["modules", index, key], message: `${row.name}: ${other} is not another module of this price book.` });
    }
  });
  for (const id of ["NESTO_PLATFORM", "ROZARIS"] as const) {
    if (!config.foundations.some((row) => row.id === id)) context.addIssue({ code: "custom", path: ["foundations"], message: `The ${id} foundation is missing.` });
    if (!config.users.some((row) => row.foundation === id)) context.addIssue({ code: "custom", path: ["users"], message: `The ${id} user rule is missing.` });
  }
});

export const pricingPromotionConfigSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_\-]+$/).max(80),
  displayName: z.string().trim().min(2).max(160).optional(),
  enabled: z.boolean(),
  product: foundation,
  requiredContractMonths: z.union([z.literal(12), z.literal(24)]),
  periods: z.array(z.object({
    months: z.number().int().min(1).max(24),
    discountPercent: z.number().int().min(0).max(100),
  }).strict()).min(1).max(12),
}).strict().refine((value) => value.periods.reduce((sum, period) => sum + period.months, 0) <= value.requiredContractMonths, {
  message: "Promotion periods cannot exceed the contract term.",
});

export const createPricingVersionSchema = z.object({
  versionCode: z.string().trim().regex(/^\d{4}\.\d{2}(?:\.\d+)?$/).max(30),
}).strict();

export const updatePricingVersionSchema = z.object({
  config: pricingConfigSchema,
  effectiveFrom: z.string().datetime(),
}).strict();

export const publishPricingVersionSchema = z.object({
  confirmed: z.literal(true),
  reason: z.string().trim().min(3).max(500),
}).strict();

export const updatePricingPromotionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  config: pricingPromotionConfigSchema,
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
}).strict();

export type PricingInput = z.infer<typeof pricingRequestSchema>;
export type PricingLeadInput = z.infer<typeof pricingLeadSchema>;
