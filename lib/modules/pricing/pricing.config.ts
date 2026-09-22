import type { PricingConfig, PricingPromotionConfig, PricingRequest } from "./pricing.types";

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  version: "2026.09",
  currency: "EUR",
  nestoERP: {
    baseMonthlyCents: 250_000,
    includedCompanies: 1,
    includedProjects: 1,
    includedUsersPerFullCompany: 15,
    additionalGroupCompanyMonthlyCents: 25_000,
    additionalJVCompanyMonthlyCents: 25_000,
    documentsOnlyCompanyMonthlyCents: 10_000,
    additionalProjectMonthlyCents: 25_000,
    userPackSize: 10,
    userPackMonthlyCents: 35_000,
  },
  rozaris: {
    projectTypes: {
      basic: { monthly24Cents: 65_000, monthly12Cents: 130_000 },
      large: { monthly24Cents: 130_000, monthly12Cents: 260_000 },
      village: { monthly24Cents: 260_000, monthly12Cents: 520_000 },
    },
  },
  indexation: {
    enabled: true,
    source: "EUROSTAT_HICP_EURO_AREA_ALL_ITEMS",
    floorPercent: 0,
    capPercent: 5,
    firstAdjustmentMonth: 13,
  },
};

export const DEFAULT_LAUNCH_PROMOTION: PricingPromotionConfig = {
  code: "NESTO_LAUNCH_24",
  enabled: true,
  product: "NESTO_ERP",
  requiredContractMonths: 24,
  periods: [
    { months: 3, discountPercent: 100 },
    { months: 3, discountPercent: 50 },
  ],
};

export const DEFAULT_PRICING_REQUEST: PricingRequest = {
  productMode: "NESTO_ERP",
  companies: { additionalGroup: 0, jointVenture: 0, documentsOnly: 0 },
  activeProjects: 1,
  activeUsers: 15,
  rozaris: { basicProjects: 0, largeProjects: 0, villageProjects: 0 },
  contractMonths: 24,
  promotionCode: DEFAULT_LAUNCH_PROMOTION.code,
};

export const PRICING_EXCLUSIONS = [
  "VAT",
  "Custom development",
  "Custom integrations",
  "Data migration beyond standard onboarding",
  "3D model production and project preparation",
  "Third-party licenses and paid external services",
  "Custom hardware",
  "Custom training outside agreed onboarding",
  "Future HICP adjustments",
] as const;
