/**
 * Modular public pricing (Pricing Page UX & Modular Pricing PRD §2, §11, §40-§42).
 *
 * Foundation + Modules + Companies + Projects + Users + Contract = the
 * recurring price. Every amount is integer cents and comes from the active
 * price book; the browser's estimate is optimistic, the server's is the answer.
 */

export type Foundation = "NESTO_PLATFORM" | "ROZARIS";
export type ContractMonths = 12 | 24;
export type RozarisClass = "BASIC" | "LARGE" | "VILLAGE";
export type ModuleTier = "S" | "A" | "B" | "C" | "ACCESS";
export type UserAllowanceMode = "MAX_PROJECT" | "SUM_PROJECTS" | "FIRST_PROJECT_ONLY";

export type PricingModule = {
  id: string;
  name: string;
  group: string;
  /** Sold at all in this price book. */
  enabled: boolean;
  /** Shown on the public page; a technical dependency is enabled but not public. */
  public: boolean;
  tier: ModuleTier;
  /** What a company pays for the module a month, on top of `monthlyPerUserCents` for each user (a group has every module in its own price). */
  monthlyPriceCents: number;
  /** For each user a month. */
  monthlyPerUserCents: number;
  includedInFoundations: Foundation[];
  lockedWhenIncluded: boolean;
  dependencies: string[];
  conflicts: string[];
  /** Lighter modules this one contains: choosing it replaces them, never charging twice (§13). */
  absorbs: string[];
  shortDescription: string;
  description: string;
  imageKey?: string;
  sortOrder: number;
};

export type FoundationConfig = {
  id: Foundation;
  enabled: boolean;
  name: string;
  description: string;
  /** Recurring base; ROZARIS is priced by its project classes, so its base is usually zero. */
  baseMonthlyCents: number;
  /** The least its NESTO charges come to a month: a smaller setup is charged this (zero for none). */
  minimumMonthlyCents: number;
  included: string[];
  imageKey?: string;
};

export type CompanyRules = {
  /** Companies the foundation includes. */
  included: number;
  /** False where extra companies are arranged in the proposal rather than priced here. */
  additionalAvailable: boolean;
  fullGroupMonthlyCents: number;
  jointVentureMonthlyCents: number;
  documentsOnlyMonthlyCents: number;
  /** Users a full Group or JV company adds to the allowance. */
  includedUsersPerFullCompany: number;
};

export type UserPricingRule = {
  foundation: Foundation;
  packSize: number;
  pricePerPackCents: number;
};

/** Who is buying the NESTO Platform: one company choosing its modules, or a group of companies with every module (docs/pricing-modules.md). */
export type CustomerType = "COMPANY" | "GROUP";

export type CustomerRules = {
  company: { minUsers: number };
  /** Every module for every company: `perCompanyCents` for each company and `perUserCents` for each user. Not offered while both are zero. */
  group: { minUsers: number; minCompanies: number; perCompanyCents: number; perUserCents: number };
};

export type PricingConfig = {
  schemaVersion: 2;
  version: string;
  currency: "EUR";
  foundations: FoundationConfig[];
  modules: PricingModule[];
  companies: Record<Foundation, CompanyRules>;
  customers: CustomerRules;
  nestoProjects: { included: number; additionalMonthlyCents: number };
  /** Users the NESTO Platform foundation includes before companies add theirs. */
  nestoIncludedUsers: number;
  rozaris: {
    classes: Record<RozarisClass, { name: string; guidance: string; monthly24Cents: number; monthly12Cents: number; includedUsers: number; imageKey?: string }>;
    userAllowanceMode: UserAllowanceMode;
  };
  users: UserPricingRule[];
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
  /** The foundation whose NESTO charges it discounts; ROZARIS project fees are never discounted (§28). */
  product: Foundation;
  requiredContractMonths: ContractMonths;
  periods: Array<{ months: number; discountPercent: number }>;
};

export type PricingRequest = {
  foundation: Foundation;
  modules: string[];
  companies: { fullGroup: number; jointVenture: number; documentsOnly: number };
  nestoProjects?: { active: number };
  rozarisProjects?: Array<{ tempId: string; type: RozarisClass }>;
  /** NESTO Platform only; a company when not given. */
  customer?: CustomerType;
  activeUsers: number;
  contractMonths: ContractMonths;
  promotionCode?: string | null;
};

export type ModuleReason = "FOUNDATION" | "ROZARIS" | "GROUP" | "SELECTED" | "DEPENDENCY";

export type PricingQuote = {
  quoteId: string | null;
  quoteReference: string | null;
  pricingVersion: string;
  currency: "EUR";
  normalizedConfiguration: PricingRequest;
  foundation: { id: Foundation; monthlyCents: number; label: string };
  customer: CustomerType;
  /**
   * `monthlyCents` is the module's whole charge: its monthly price and
   * `perUserCents` for each user. Included at no charge: with the foundation,
   * with ROZARIS 3D (Sales), or in the group's price.
   */
  modules: Array<{ id: string; name: string; included: boolean; locked: boolean; monthlyCents: number; perUserCents: number; reason: ModuleReason }>;
  /** A group's own line: every module for `companies` companies and `users` users. */
  group: { companies: number; perCompanyCents: number; users: number; perUserCents: number; monthlyCents: number } | null;
  companies: { included: number; fullGroup: number; jointVenture: number; documentsOnly: number; monthlyCents: number };
  projects: Array<{ id: string; label: string; type: string; monthlyCents: number; includedUsers: number }>;
  users: { requested: number; included: number; billable: number; packSize: number; packs: number; monthlyCents: number };
  /** The foundation's monthly minimum and what was added to reach it (zero when the setup is above it). */
  minimum: { monthlyCents: number; topUpCents: number };
  /** Recurring NESTO charges (foundation, modules, companies, projects, users, the minimum's top-up) — what a promotion may discount. */
  nestoMonthlyCents: number;
  rozarisMonthlyCents: number;
  standardMonthlyCents: number;
  schedule: Array<{ fromMonth: number; toMonth: number; monthlyCents: number; discountPercent: number; label: string }>;
  promotion: { requestedCode: string | null; appliedCode: string | null; applied: boolean };
  contractMonths: ContractMonths;
  preIndexationContractValueCents: number;
  exclusions: string[];
  notices: string[];
  indexation: { enabled: boolean; appliesFromMonth: number; source: string; floorPercent: number; capPercent: number };
};

export type PublicPricingConfig = {
  pricingVersion: string;
  currency: "EUR";
  foundations: FoundationConfig[];
  modules: PricingModule[];
  companies: Record<Foundation, CompanyRules>;
  customers: CustomerRules;
  nestoProjects: PricingConfig["nestoProjects"];
  nestoIncludedUsers: number;
  rozaris: PricingConfig["rozaris"];
  users: UserPricingRule[];
  contractOptions: ContractMonths[];
  promotions: PricingPromotionConfig[];
  indexation: PricingConfig["indexation"];
};
