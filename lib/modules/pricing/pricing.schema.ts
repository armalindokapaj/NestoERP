import { z } from "zod";

const publicCount = (max: number) => z.number().int().min(0).max(max);
const cents = z.number().int().min(0).max(2_000_000_000);

export const pricingRequestSchema = z.object({
  productMode: z.enum(["NESTO_ERP", "ROZARIS_ONLY"]),
  companies: z.object({
    additionalGroup: publicCount(500),
    jointVenture: publicCount(500),
    documentsOnly: publicCount(500),
  }).strict(),
  activeProjects: publicCount(1_000),
  activeUsers: z.number().int().min(1).max(100_000),
  rozaris: z.object({
    basicProjects: publicCount(1_000),
    largeProjects: publicCount(1_000),
    villageProjects: publicCount(1_000),
  }).strict(),
  contractMonths: z.union([z.literal(12), z.literal(24)]),
  promotionCode: z.string().trim().max(80).nullable().optional(),
}).strict().superRefine((input, context) => {
  if (input.productMode === "NESTO_ERP" && input.activeProjects < 1) {
    context.addIssue({ code: "custom", path: ["activeProjects"], message: "NESTO ERP requires at least one active project." });
  }
});

export const calculatePricingRequestSchema = z.object({
  productMode: z.enum(["NESTO_ERP", "ROZARIS_ONLY"]),
  companies: z.object({
    additionalGroup: publicCount(500),
    jointVenture: publicCount(500),
    documentsOnly: publicCount(500),
  }).strict(),
  activeProjects: publicCount(1_000),
  activeUsers: z.number().int().min(1).max(100_000),
  rozaris: z.object({
    basicProjects: publicCount(1_000),
    largeProjects: publicCount(1_000),
    villageProjects: publicCount(1_000),
  }).strict(),
  contractMonths: z.union([z.literal(12), z.literal(24)]),
  promotionCode: z.string().trim().max(80).nullable().optional(),
  persistQuote: z.boolean().optional().default(false),
}).strict().superRefine((input, context) => {
  if (input.productMode === "NESTO_ERP" && input.activeProjects < 1) {
    context.addIssue({ code: "custom", path: ["activeProjects"], message: "NESTO ERP requires at least one active project." });
  }
});

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

export const pricingConfigSchema = z.object({
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
  indexation: z.object({
    enabled: z.boolean(),
    source: z.string().trim().regex(/^EUROSTAT_HICP_[A-Z0-9_]+$/).max(120),
    floorPercent: z.number().int().min(0).max(100),
    capPercent: z.number().int().min(0).max(100),
    firstAdjustmentMonth: z.number().int().min(2).max(120),
  }).strict().refine((value) => value.capPercent >= value.floorPercent, { message: "HICP cap must be at least the floor." }),
}).strict();

export const pricingPromotionConfigSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_\-]+$/).max(80),
  displayName: z.string().trim().min(2).max(160).optional(),
  enabled: z.boolean(),
  product: z.enum(["NESTO_ERP", "ROZARIS_ONLY"]),
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
