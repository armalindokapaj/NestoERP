import { describe, expect, it } from "vitest";

import { DEFAULT_LAUNCH_PROMOTION, DEFAULT_PRICING_CONFIG, defaultRequest, upgradeLegacyConfig, type LegacyPricingConfig } from "@/lib/modules/pricing/pricing.config";
import { calculatePricing, resolveModules } from "@/lib/modules/pricing/pricing.engine";
import { pricingConfigSchema, pricingPromotionConfigSchema, pricingRequestSchema } from "@/lib/modules/pricing/pricing.schema";
import type { PricingConfig, PricingRequest, RozarisClass } from "@/lib/modules/pricing/pricing.types";

/**
 * The modular pricing engine against the PRD's own cases (Modular Pricing PRD
 * §56 Tests B-J, §13, §14, §24-§28, §38, §55).
 */

/** The default book with the add-on prices a published version would carry. */
const BOOK: PricingConfig = {
  ...DEFAULT_PRICING_CONFIG,
  modules: DEFAULT_PRICING_CONFIG.modules.map((row) => ({
    ...row,
    monthlyPriceCents: ({ LEGAL_DOCUMENTS: 15_000, LEGAL_FULL: 40_000, FINANCE: 50_000 } as Record<string, number>)[row.id] ?? row.monthlyPriceCents,
  })),
};

function rozaris(types: RozarisClass[], extra: Partial<PricingRequest> = {}): PricingRequest {
  return { ...defaultRequest("ROZARIS", BOOK), rozarisProjects: types.map((type, index) => ({ tempId: `p${index}`, type })), ...extra };
}
const quote = (input: PricingRequest, book = BOOK) => calculatePricing(input, book, DEFAULT_LAUNCH_PROMOTION);

describe("ROZARIS foundation (Tests B, E-H)", () => {
  it("includes Sales and keeps it locked; asking to remove it changes nothing (Test B)", () => {
    const result = quote(rozaris(["BASIC"], { modules: [] }));
    expect(result.modules.find((row) => row.id === "SALES")).toMatchObject({ included: true, locked: true, monthlyCents: 0 });
    expect(result.modules.some((row) => row.id === "DOCUMENTS_CORE")).toBe(false);
  });

  it.each([
    ["BASIC", 24, 65_000, 5], ["LARGE", 24, 130_000, 10], ["VILLAGE", 24, 260_000, 20],
    ["BASIC", 12, 130_000, 5], ["LARGE", 12, 260_000, 10], ["VILLAGE", 12, 520_000, 20],
  ] as const)("%s on %i months is %i cents with %i users", (type, months, cents, users) => {
    const result = quote(rozaris([type], { contractMonths: months, activeUsers: users }));
    expect(result.standardMonthlyCents).toBe(cents);
    expect(result.users).toMatchObject({ included: users, billable: 0, monthlyCents: 0 });
  });

  it("never discounts ROZARIS with the NESTO launch offer (§28)", () => {
    const result = quote(rozaris(["LARGE"], { promotionCode: "NESTO_LAUNCH_24" }));
    expect(result.promotion.applied).toBe(false);
    expect(result.schedule).toEqual([expect.objectContaining({ fromMonth: 1, toMonth: 24, monthlyCents: 130_000 })]);
    expect(result.preIndexationContractValueCents).toBe(130_000 * 24);
  });
});

describe("modules (Tests C, D; §13, §14)", () => {
  it("charges Legal Documents once and never Full Legal (Test C)", () => {
    const result = quote(rozaris(["LARGE"], { modules: ["LEGAL_DOCUMENTS"] }));
    expect(result.modules.filter((row) => !row.included)).toEqual([expect.objectContaining({ id: "LEGAL_DOCUMENTS", monthlyCents: 15_000 })]);
    expect(result.standardMonthlyCents).toBe(130_000 + 15_000);
    expect(result.modules.find((row) => row.id === "SALES")?.included).toBe(true);
  });

  it("lets Full Legal absorb Legal Documents with no double charge (Test D)", () => {
    const result = quote(rozaris(["LARGE"], { modules: ["LEGAL_DOCUMENTS", "LEGAL_FULL"] }));
    expect(result.modules.filter((row) => !row.included).map((row) => row.id)).toEqual(["LEGAL_FULL"]);
    expect(result.standardMonthlyCents).toBe(130_000 + 40_000);
    expect(result.notices.join(" ")).toMatch(/Legal Documents is included in Full Legal/);
    expect(result.normalizedConfiguration.modules).toEqual(["LEGAL_FULL"]);
  });

  it("drops a module the foundation does not sell, and a technical dependency is never billed", () => {
    const { rows, notices } = resolveModules(BOOK, "ROZARIS", ["HR", "LEGAL_FULL"]);
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining(["DOCUMENTS_CORE", "SALES", "LEGAL_FULL"]));
    expect(rows.some((row) => row.id === "HR")).toBe(false);
    expect(notices.join(" ")).toMatch(/HR \/ Workforce is not available/);
    expect(rows.find((row) => row.id === "DOCUMENTS_CORE")?.monthlyCents).toBe(0);
  });

  it("adds a paid dependency visibly and says why", () => {
    const book: PricingConfig = { ...BOOK, modules: BOOK.modules.map((row) => row.id === "LEGAL_FULL" ? { ...row, dependencies: ["FINANCE"] } : row) };
    const result = quote(rozaris(["BASIC"], { modules: ["LEGAL_FULL"] }), book);
    expect(result.modules.find((row) => row.id === "FINANCE")).toMatchObject({ included: false, monthlyCents: 50_000 });
    expect(result.notices.join(" ")).toMatch(/Finance was added because Full Legal needs it/);
  });
});

describe("users (Test I; §24-§26)", () => {
  it("bills 6 extra users over Large as 2 packs of 5 at €175 (Test I)", () => {
    const result = quote(rozaris(["LARGE"], { activeUsers: 16 }));
    expect(result.users).toEqual({ requested: 16, included: 10, billable: 6, packSize: 5, packs: 2, monthlyCents: 35_000 });
  });

  it.each([["MAX_PROJECT", 10], ["SUM_PROJECTS", 15], ["FIRST_PROJECT_ONLY", 5]] as const)("aggregates several projects by %s", (mode, included) => {
    const book = { ...BOOK, rozaris: { ...BOOK.rozaris, userAllowanceMode: mode } };
    expect(quote(rozaris(["BASIC", "LARGE"], { activeUsers: 1 }), book).users.included).toBe(included);
  });
});

describe("NESTO Platform", () => {
  it("keeps today's price for the upgraded first-shape book and applies the launch offer to NESTO charges only", () => {
    const input: PricingRequest = { ...defaultRequest("NESTO_PLATFORM", BOOK), companies: { fullGroup: 1, jointVenture: 0, documentsOnly: 1 }, nestoProjects: { active: 2 }, activeUsers: 41, rozarisProjects: [{ tempId: "r", type: "BASIC" }], promotionCode: "NESTO_LAUNCH_24" };
    const result = quote(input);
    // 2,500 base + 250 group + 100 docs + 250 project + 1 pack (41 − 30 = 11 → 2 × 10 = €700)
    expect(result.nestoMonthlyCents).toBe(250_000 + 25_000 + 10_000 + 25_000 + 70_000);
    expect(result.rozarisMonthlyCents).toBe(65_000);
    expect(result.schedule.map((period) => period.monthlyCents)).toEqual([65_000, Math.round(result.nestoMonthlyCents / 2) + 65_000, result.standardMonthlyCents]);
    expect(result.modules.every((row) => row.included)).toBe(true);
  });
});

describe("price books and requests", () => {
  const legacy: LegacyPricingConfig = {
    version: "2026.09", currency: "EUR",
    nestoERP: { baseMonthlyCents: 250_000, includedCompanies: 1, includedProjects: 1, includedUsersPerFullCompany: 15, additionalGroupCompanyMonthlyCents: 25_000, additionalJVCompanyMonthlyCents: 25_000, documentsOnlyCompanyMonthlyCents: 10_000, additionalProjectMonthlyCents: 25_000, userPackSize: 10, userPackMonthlyCents: 35_000 },
    rozaris: { projectTypes: { basic: { monthly24Cents: 65_000, monthly12Cents: 130_000 }, large: { monthly24Cents: 130_000, monthly12Cents: 260_000 }, village: { monthly24Cents: 260_000, monthly12Cents: 520_000 } } },
    indexation: DEFAULT_PRICING_CONFIG.indexation,
  };

  it("upgrades a first-shape book to a valid modular one without inventing an add-on price", () => {
    const upgraded = upgradeLegacyConfig(legacy);
    expect(pricingConfigSchema.safeParse(upgraded).success).toBe(true);
    expect(upgraded.modules.every((row) => row.monthlyPriceCents === 0)).toBe(true);
    expect(pricingConfigSchema.safeParse(DEFAULT_PRICING_CONFIG).success).toBe(true);
  });

  it("rejects a module that names an unknown dependency", () => {
    const broken = { ...DEFAULT_PRICING_CONFIG, modules: DEFAULT_PRICING_CONFIG.modules.map((row) => row.id === "SALES" ? { ...row, dependencies: ["NOPE"] } : row) };
    expect(pricingConfigSchema.safeParse(broken).success).toBe(false);
  });

  it("reads old promotion products and old request foundations", () => {
    expect(pricingPromotionConfigSchema.parse({ ...DEFAULT_LAUNCH_PROMOTION, product: "NESTO_ERP" }).product).toBe("NESTO_PLATFORM");
    expect(pricingRequestSchema.parse({ ...rozaris(["BASIC"]), foundation: "ROZARIS_ONLY" }).foundation).toBe("ROZARIS");
  });

  it("validates bounds and the Platform's project", () => {
    expect(pricingRequestSchema.safeParse(rozaris(["BASIC"], { activeUsers: 0 })).success).toBe(false);
    expect(pricingRequestSchema.safeParse(rozaris(["BASIC"], { activeUsers: 100_001 })).success).toBe(false);
    expect(pricingRequestSchema.safeParse({ ...defaultRequest("NESTO_PLATFORM", BOOK), nestoProjects: undefined }).success).toBe(false);
    expect(pricingRequestSchema.safeParse(rozaris(["BASIC"], { companies: { fullGroup: -1, jointVenture: 0, documentsOnly: 0 } })).success).toBe(false);
  });

  it("keeps every amount in whole cents (§55)", () => {
    const result = quote(rozaris(["BASIC", "VILLAGE"], { contractMonths: 12, activeUsers: 33, modules: ["LEGAL_DOCUMENTS"] }));
    for (const value of [result.standardMonthlyCents, result.preIndexationContractValueCents, ...result.schedule.map((period) => period.monthlyCents)]) expect(Number.isInteger(value)).toBe(true);
  });
});
