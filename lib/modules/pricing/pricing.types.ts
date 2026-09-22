export type ProductMode = "NESTO_ERP" | "ROZARIS_ONLY";
export type ContractMonths = 12 | 24;

export type PricingConfig = {
  version: string;
  currency: "EUR";
  nestoERP: {
    baseMonthlyCents: number;
    includedCompanies: number;
    includedProjects: number;
    includedUsersPerFullCompany: number;
    additionalGroupCompanyMonthlyCents: number;
    additionalJVCompanyMonthlyCents: number;
    documentsOnlyCompanyMonthlyCents: number;
    additionalProjectMonthlyCents: number;
    userPackSize: number;
    userPackMonthlyCents: number;
  };
  rozaris: {
    projectTypes: Record<"basic" | "large" | "village", {
      monthly24Cents: number;
      monthly12Cents: number;
    }>;
  };
  indexation: {
    enabled: boolean;
    source: string;
    floorPercent: number;
    capPercent: number;
    firstAdjustmentMonth: number;
  };
};

export type PricingPromotionConfig = {
  code: string;
  displayName?: string;
  enabled: boolean;
  product: ProductMode;
  requiredContractMonths: ContractMonths;
  periods: Array<{ months: number; discountPercent: number }>;
};

export type PricingRequest = {
  productMode: ProductMode;
  companies: {
    additionalGroup: number;
    jointVenture: number;
    documentsOnly: number;
  };
  activeProjects: number;
  activeUsers: number;
  rozaris: {
    basicProjects: number;
    largeProjects: number;
    villageProjects: number;
  };
  contractMonths: ContractMonths;
  promotionCode?: string | null;
};

export type PricingQuote = {
  quoteId: string | null;
  quoteReference: string | null;
  pricingVersion: string;
  currency: "EUR";
  configuration: PricingRequest;
  included: {
    fullCompanies: number;
    includedUsers: number;
    includedProjects: number;
  };
  breakdown: {
    basePlatformMonthly: number;
    groupCompaniesMonthly: number;
    jointVentureCompaniesMonthly: number;
    documentsOnlyCompaniesMonthly: number;
    additionalProjectsMonthly: number;
    additionalUsersMonthly: number;
    rozarisMonthly: number;
  };
  users: {
    requested: number;
    included: number;
    extra: number;
    packs: number;
    packSize: number;
  };
  nestoMonthly: number;
  standardMonthly: number;
  promotionalSchedule: Array<{
    fromMonth: number;
    toMonth: number;
    nestoMonthly: number;
    rozarisMonthly: number;
    totalMonthly: number;
    discountPercent: number;
  }>;
  promotion: {
    requestedCode: string | null;
    appliedCode: string | null;
    applied: boolean;
  };
  contract: {
    months: ContractMonths;
    preIndexationValue: number;
  };
  exclusions: string[];
  indexation: {
    enabled: boolean;
    appliesFromMonth: number;
    source: string;
    floorPercent: number;
    capPercent: number;
    futureAdjustmentIncludedInEstimate: false;
  };
};

export type PublicPricingConfig = {
  pricingVersion: string;
  currency: "EUR";
  publicRules: PricingConfig;
  promotions: PricingPromotionConfig[];
};
