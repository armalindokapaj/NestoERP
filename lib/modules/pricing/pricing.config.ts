import type { Foundation, PricingConfig, PricingModule, PricingPromotionConfig, PricingRequest } from "./pricing.types";

/*
 * The shape of a price book and the one this code starts from (Modular Pricing
 * PRD §11, §17-§25, §43). Prices here are only the seed of a first version:
 * the public page always reads the active version from the database.
 *
 * A module is offered as an add-on to a foundation only when the price book
 * gives it an add-on price there; until Pricing Admin prices it, it is either
 * included in the foundation or not sold with it. No price is invented.
 */

const catalogModule = (
  id: string, name: string, group: string, tier: PricingModule["tier"], shortDescription: string, description: string,
  extra: Partial<PricingModule> = {},
): PricingModule => ({
  id, name, group, tier, shortDescription, description,
  enabled: true, public: true, monthlyPriceCents: 0,
  includedInFoundations: ["NESTO_PLATFORM"], lockedWhenIncluded: false,
  dependencies: [], conflicts: [], absorbs: [], imageKey: id.toLowerCase().replaceAll("_", "-"), sortOrder: 0,
  ...extra,
});

export const MODULE_GROUPS = ["Commercial", "Corporate / Control", "Delivery", "Operations", "Collaboration / Support"] as const;

export const DEFAULT_MODULES: PricingModule[] = [
  catalogModule("DOCUMENTS_CORE", "Document storage", "Collaboration / Support", "ACCESS", "The file store other modules build on.", "Technical foundation for documents; enabled automatically and never billed.", { public: false, includedInFoundations: ["NESTO_PLATFORM", "ROZARIS"], lockedWhenIncluded: true }),
  catalogModule("SALES", "Sales", "Commercial", "S", "Units, buyers, contracts and the sales workflow.", "Unit inventory and status, buyers and clients, reservations, sales contracts and their documents.", { includedInFoundations: ["NESTO_PLATFORM", "ROZARIS"], lockedWhenIncluded: true, dependencies: ["DOCUMENTS_CORE"], sortOrder: 10 }),
  catalogModule("FINANCE", "Finance", "Commercial", "S", "Budgets, invoices, payments and cash flow.", "Project and company finance: budgets, commitments, invoices, payments and reporting.", { sortOrder: 20 }),
  catalogModule("LEGAL_DOCUMENTS", "Legal Documents", "Corporate / Control", "ACCESS", "Contract-related legal files without the full Legal module.", "Upload and manage contract-related legal documents: categories, version history, access control, approvals and comments.", { dependencies: ["DOCUMENTS_CORE"], sortOrder: 30 }),
  catalogModule("LEGAL_FULL", "Full Legal", "Corporate / Control", "A", "Legal register, matters, obligations and deadlines.", "The complete Legal module: register, matters, obligations, claims, deadlines, workflows and reporting. Includes Legal Documents.", { dependencies: ["DOCUMENTS_CORE"], absorbs: ["LEGAL_DOCUMENTS"], sortOrder: 31 }),
  catalogModule("HR", "HR / Workforce", "Corporate / Control", "A", "People, employment, qualifications and workforce.", "Employees, employment history, files, qualifications and workforce records.", { sortOrder: 40 }),
  catalogModule("PROJECT_MANAGEMENT", "Project Management", "Delivery", "S", "Tasks, planning, milestones and delivery control.", "Project tasks, planning, milestones and progress across the project team.", { sortOrder: 50 }),
  catalogModule("ARCHITECTURE", "Architecture", "Delivery", "B", "Design packages, drawings and revisions.", "Architectural design work: packages, drawings, revisions and reviews.", { dependencies: ["DOCUMENTS_CORE"], sortOrder: 51 }),
  catalogModule("ENGINEERING", "Engineering", "Delivery", "B", "Engineering deliverables, RFIs and submittals.", "Engineering deliverables, requests for information, submittals and revisions.", { dependencies: ["DOCUMENTS_CORE"], sortOrder: 52 }),
  catalogModule("HSE", "HSE", "Delivery", "B", "Health, safety and environment on site.", "Permits, inspections, incidents and safety records for every site.", { sortOrder: 53 }),
  catalogModule("PROCUREMENT", "Procurement", "Operations", "A", "Requests, suppliers, orders and receipts.", "Purchase requests, supplier selection, purchase orders and goods receipts.", { sortOrder: 60 }),
  catalogModule("INVENTORY", "Inventory / Storage", "Operations", "B", "Warehouses, stock and movements.", "Warehouses, locations, stock levels, issues, returns and transfers.", { sortOrder: 61 }),
  catalogModule("CONTRACTORS", "Contractors", "Operations", "B", "Contractors, their work and their documents.", "Contractor records, engagements, work packages and compliance documents.", { sortOrder: 62 }),
  catalogModule("DOCUMENTS", "Documents", "Collaboration / Support", "C", "Shared documents with versions and access control.", "Company and project documents with folders, versions, sharing and approvals.", { dependencies: ["DOCUMENTS_CORE"], sortOrder: 70 }),
  catalogModule("MEETINGS", "Meetings", "Collaboration / Support", "C", "Agendas, minutes and actions.", "Meeting agendas, minutes, decisions and follow-up actions.", { sortOrder: 71 }),
  catalogModule("CALENDAR", "Calendar", "Collaboration / Support", "C", "Shared project and company calendars.", "Company and project calendars with events from every module.", { sortOrder: 72 }),
  catalogModule("TIMESHEETS", "Timesheets", "Collaboration / Support", "C", "Time recorded against projects.", "Time entries, approvals and project time reporting.", { sortOrder: 73 }),
  catalogModule("DAILY_LOG", "Daily Log", "Collaboration / Support", "C", "Daily site reports.", "Daily site logs: weather, workforce, work done and linked records.", { sortOrder: 74 }),
  catalogModule("COLLABORATION", "Announcements / Collaboration", "Collaboration / Support", "C", "Announcements and favorites.", "Company announcements and shared favorites.", { sortOrder: 75 }),
];

const ROZARIS_INCLUDED = ["Sales", "Units", "Contracts", "Clients / Buyers", "Unit inventory and status", "Unit and contract documents", "Unit PDF plans", "ROZARIS 3D Viewer", "Standard project dashboard"];

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  schemaVersion: 2,
  version: "2026.09",
  currency: "EUR",
  foundations: [
    { id: "ROZARIS", enabled: true, name: "NESTO ROZARIS", description: "A focused real-estate sales environment for Units, Contracts and the published ROZARIS 3D experience.", baseMonthlyCents: 0, included: ROZARIS_INCLUDED, imageKey: "foundation-rozaris" },
    { id: "NESTO_PLATFORM", enabled: true, name: "NESTO Platform", description: "Build a modular company operating platform by selecting the NESTO modules your organization needs.", baseMonthlyCents: 250_000, included: ["1 company", "1 active project", "15 active users"], imageKey: "foundation-platform" },
  ],
  modules: DEFAULT_MODULES,
  companies: {
    NESTO_PLATFORM: { included: 1, additionalAvailable: true, fullGroupMonthlyCents: 25_000, jointVentureMonthlyCents: 25_000, documentsOnlyMonthlyCents: 10_000, includedUsersPerFullCompany: 15 },
    ROZARIS: { included: 1, additionalAvailable: false, fullGroupMonthlyCents: 0, jointVentureMonthlyCents: 0, documentsOnlyMonthlyCents: 0, includedUsersPerFullCompany: 0 },
  },
  nestoProjects: { included: 1, additionalMonthlyCents: 25_000 },
  nestoIncludedUsers: 15,
  rozaris: {
    classes: {
      BASIC: { name: "Basic", guidance: "An individual building or standard development with a straightforward inventory.", monthly24Cents: 65_000, monthly12Cents: 130_000, includedUsers: 5, imageKey: "rozaris-basic" },
      LARGE: { name: "Large", guidance: "A larger residential or mixed-use development: multiple buildings, more inventory and 3D complexity.", monthly24Cents: 130_000, monthly12Cents: 260_000, includedUsers: 10, imageKey: "rozaris-large" },
      VILLAGE: { name: "Village / Masterplan", guidance: "A villa village, resort, campus or large multi-zone masterplan.", monthly24Cents: 260_000, monthly12Cents: 520_000, includedUsers: 20, imageKey: "rozaris-village" },
    },
    userAllowanceMode: "MAX_PROJECT",
  },
  users: [
    { foundation: "NESTO_PLATFORM", packSize: 10, pricePerPackCents: 35_000 },
    { foundation: "ROZARIS", packSize: 5, pricePerPackCents: 17_500 },
  ],
  indexation: { enabled: true, source: "EUROSTAT_HICP_EURO_AREA_ALL_ITEMS", floorPercent: 0, capPercent: 5, firstAdjustmentMonth: 13 },
};

/** The first price book shape (one ERP product with everything included). */
export type LegacyPricingConfig = {
  version: string;
  currency: "EUR";
  nestoERP: {
    baseMonthlyCents: number; includedCompanies: number; includedProjects: number; includedUsersPerFullCompany: number;
    additionalGroupCompanyMonthlyCents: number; additionalJVCompanyMonthlyCents: number; documentsOnlyCompanyMonthlyCents: number;
    additionalProjectMonthlyCents: number; userPackSize: number; userPackMonthlyCents: number;
  };
  rozaris: { projectTypes: Record<"basic" | "large" | "village", { monthly24Cents: number; monthly12Cents: number }> };
  indexation: PricingConfig["indexation"];
};

/**
 * Reads a first-shape price book as a modular one without changing what it
 * charges: the NESTO Platform foundation keeps its base with every module
 * included, as that book sold it, and its ROZARIS rates carry over.
 */
export function upgradeLegacyConfig(legacy: LegacyPricingConfig): PricingConfig {
  const erp = legacy.nestoERP;
  const base = DEFAULT_PRICING_CONFIG;
  const types = legacy.rozaris.projectTypes;
  return {
    ...base,
    version: legacy.version,
    foundations: base.foundations.map((foundation) => foundation.id === "NESTO_PLATFORM"
      ? { ...foundation, baseMonthlyCents: erp.baseMonthlyCents, included: [`${erp.includedCompanies} ${erp.includedCompanies === 1 ? "company" : "companies"}`, `${erp.includedProjects} active ${erp.includedProjects === 1 ? "project" : "projects"}`, `${erp.includedCompanies * erp.includedUsersPerFullCompany} active users`] }
      : foundation),
    companies: {
      ...base.companies,
      NESTO_PLATFORM: { included: erp.includedCompanies, additionalAvailable: true, fullGroupMonthlyCents: erp.additionalGroupCompanyMonthlyCents, jointVentureMonthlyCents: erp.additionalJVCompanyMonthlyCents, documentsOnlyMonthlyCents: erp.documentsOnlyCompanyMonthlyCents, includedUsersPerFullCompany: erp.includedUsersPerFullCompany },
    },
    nestoProjects: { included: erp.includedProjects, additionalMonthlyCents: erp.additionalProjectMonthlyCents },
    nestoIncludedUsers: erp.includedCompanies * erp.includedUsersPerFullCompany,
    rozaris: {
      ...base.rozaris,
      classes: {
        BASIC: { ...base.rozaris.classes.BASIC, ...types.basic },
        LARGE: { ...base.rozaris.classes.LARGE, ...types.large },
        VILLAGE: { ...base.rozaris.classes.VILLAGE, ...types.village },
      },
    },
    users: [
      { foundation: "NESTO_PLATFORM", packSize: erp.userPackSize, pricePerPackCents: erp.userPackMonthlyCents },
      base.users.find((rule) => rule.foundation === "ROZARIS")!,
    ],
    indexation: legacy.indexation,
  };
}

export const DEFAULT_LAUNCH_PROMOTION: PricingPromotionConfig = {
  code: "NESTO_LAUNCH_24",
  enabled: true,
  product: "NESTO_PLATFORM",
  requiredContractMonths: 24,
  periods: [
    { months: 3, discountPercent: 100 },
    { months: 3, discountPercent: 50 },
  ],
};

export function defaultRequest(foundation: Foundation, config: Pick<PricingConfig, "nestoProjects" | "nestoIncludedUsers" | "rozaris">): PricingRequest {
  return foundation === "ROZARIS"
    ? { foundation, modules: [], companies: { fullGroup: 0, jointVenture: 0, documentsOnly: 0 }, rozarisProjects: [{ tempId: "p1", type: "BASIC" }], activeUsers: config.rozaris.classes.BASIC.includedUsers, contractMonths: 24, promotionCode: null }
    : { foundation, modules: [], companies: { fullGroup: 0, jointVenture: 0, documentsOnly: 0 }, nestoProjects: { active: config.nestoProjects.included }, rozarisProjects: [], activeUsers: config.nestoIncludedUsers, contractMonths: 24, promotionCode: null };
}

export const PRICING_EXCLUSIONS = [
  "VAT",
  "3D model production and project preparation (quoted separately)",
  "Custom development",
  "Custom integrations unless listed",
  "Data migration beyond standard onboarding",
  "Third-party licenses and paid external services",
  "Future HICP adjustments",
] as const;
