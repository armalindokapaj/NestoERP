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

/** Modules priced for each person (docs/pricing-modules.md): no base, no included users, people × the chosen modules' rates. */
describe("modules priced per person", () => {
  const PER_PERSON: Record<string, number> = { SALES: 2_800, FINANCE: 2_800, PROJECT_MANAGEMENT: 2_400, PROCUREMENT: 1_800 };
  const perPerson: PricingConfig = {
    ...DEFAULT_PRICING_CONFIG,
    foundations: DEFAULT_PRICING_CONFIG.foundations.map((row) => (row.id === "NESTO_PLATFORM" ? { ...row, baseMonthlyCents: 0 } : row)),
    modules: DEFAULT_PRICING_CONFIG.modules.map((row) => (row.id in PER_PERSON ? { ...row, monthlyPerUserCents: PER_PERSON[row.id]!, includedInFoundations: row.includedInFoundations.filter((id) => id !== "NESTO_PLATFORM") } : row)),
    companies: { ...DEFAULT_PRICING_CONFIG.companies, NESTO_PLATFORM: { ...DEFAULT_PRICING_CONFIG.companies.NESTO_PLATFORM, includedUsersPerFullCompany: 0 } },
    nestoIncludedUsers: 0,
    users: DEFAULT_PRICING_CONFIG.users.map((rule) => (rule.foundation === "NESTO_PLATFORM" ? { ...rule, pricePerPackCents: 0 } : rule)),
  };
  const platform = (modules: string[], activeUsers: number, extra: Partial<PricingRequest> = {}): PricingRequest => ({ ...defaultRequest("NESTO_PLATFORM", perPerson), modules, activeUsers, ...extra });

  it("charges each chosen module for every person, and shows its rate", () => {
    const result = calculatePricing(platform(["SALES", "FINANCE"], 15), perPerson, null);
    expect(result.modules.find((row) => row.id === "SALES")).toMatchObject({ included: false, perUserCents: 2_800, monthlyCents: 42_000 });
    expect(result.standardMonthlyCents).toBe(84_000);
    expect(result.users).toMatchObject({ included: 0, monthlyCents: 0 });
  });

  it("grows with the people, and adds further companies and projects at their own rates", () => {
    const core = ["SALES", "FINANCE", "PROJECT_MANAGEMENT", "PROCUREMENT"];
    expect(calculatePricing(platform(core, 25), perPerson, null).standardMonthlyCents).toBe(245_000);
    const group = calculatePricing(platform(core, 25, { companies: { fullGroup: 2, jointVenture: 0, documentsOnly: 0 }, nestoProjects: { active: 3 } }), perPerson, null);
    expect(group.standardMonthlyCents).toBe(245_000 + 2 * 25_000 + 2 * 25_000);
  });

  it("starts the configurator at 15 people when the book includes none, and offers a module priced only per person", () => {
    expect(defaultRequest("NESTO_PLATFORM", perPerson).activeUsers).toBe(15);
    expect(resolveModules(perPerson, "NESTO_PLATFORM", ["SALES"], 10).rows.find((row) => row.id === "SALES")).toMatchObject({ reason: "SELECTED", monthlyCents: 28_000 });
  });

  it("charges a setup below the minimum the minimum, and says how much it added", () => {
    const withMinimum: PricingConfig = { ...perPerson, foundations: perPerson.foundations.map((row) => (row.id === "NESTO_PLATFORM" ? { ...row, minimumMonthlyCents: 50_000 } : row)) };
    // 1 architect, 1 engineer and 2 CEOs on Finance and Project Management: 4 × €52 = €208.
    const small = calculatePricing(platform(["FINANCE", "PROJECT_MANAGEMENT"], 4), withMinimum, null);
    expect(small.standardMonthlyCents).toBe(50_000);
    expect(small.minimum).toEqual({ monthlyCents: 50_000, topUpCents: 50_000 - 20_800 });
    const large = calculatePricing(platform(["SALES", "FINANCE"], 15), withMinimum, null);
    expect(large.standardMonthlyCents).toBe(84_000);
    expect(large.minimum.topUpCents).toBe(0);
  });

  it("discounts the minimum with the launch offer like any NESTO charge", () => {
    const withMinimum: PricingConfig = { ...perPerson, foundations: perPerson.foundations.map((row) => (row.id === "NESTO_PLATFORM" ? { ...row, minimumMonthlyCents: 50_000 } : row)) };
    const quote = calculatePricing(platform(["SALES"], 2, { promotionCode: DEFAULT_LAUNCH_PROMOTION.code }), withMinimum, DEFAULT_LAUNCH_PROMOTION);
    expect(quote.schedule.map((period) => period.monthlyCents)).toEqual([0, 25_000, 50_000]);
  });

  it("reads a stored book without a minimum as having none", () => {
    const stored = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG)) as { foundations: Array<Record<string, unknown>> };
    for (const row of stored.foundations) delete row.minimumMonthlyCents;
    expect(pricingConfigSchema.parse(stored).foundations.every((row) => row.minimumMonthlyCents === 0)).toBe(true);
  });

  it("reads a stored book without per-person prices as charging none", () => {
    const stored = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG)) as { modules: Array<Record<string, unknown>> };
    for (const row of stored.modules) delete row.monthlyPerUserCents;
    expect(pricingConfigSchema.parse(stored).modules.every((row) => row.monthlyPerUserCents === 0)).toBe(true);
  });
});
