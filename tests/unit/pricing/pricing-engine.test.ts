import { describe, expect, it } from "vitest";

import { DEFAULT_LAUNCH_PROMOTION, DEFAULT_PRICING_CONFIG, DEFAULT_PRICING_REQUEST } from "@/lib/modules/pricing/pricing.config";
import { calculatePricing } from "@/lib/modules/pricing/pricing.engine";
import { pricingRequestSchema } from "@/lib/modules/pricing/pricing.schema";
import type { PricingRequest } from "@/lib/modules/pricing/pricing.types";

type RequestOverrides = Omit<Partial<PricingRequest>, "companies" | "rozaris"> & {
  companies?: Partial<PricingRequest["companies"]>;
  rozaris?: Partial<PricingRequest["rozaris"]>;
};

function request(overrides: RequestOverrides = {}): PricingRequest {
  return {
    ...DEFAULT_PRICING_REQUEST,
    ...overrides,
    companies: { ...DEFAULT_PRICING_REQUEST.companies, ...overrides.companies },
    rozaris: { ...DEFAULT_PRICING_REQUEST.rozaris, ...overrides.rozaris },
  };
}

describe("interactive pricing engine", () => {
  it("prices the base ERP and retains the pricing version", () => {
    const quote = calculatePricing(request({ promotionCode: null }), DEFAULT_PRICING_CONFIG, null);
    expect(quote.pricingVersion).toBe("2026.09");
    expect(quote.included).toEqual({ fullCompanies: 1, includedUsers: 15, includedProjects: 1 });
    expect(quote.standardMonthly).toBe(2_500);
    expect(quote.contract.preIndexationValue).toBe(60_000);
  });

  it("adds group, JV and documents-only companies using distinct line items", () => {
    const quote = calculatePricing(request({
      companies: { additionalGroup: 1, jointVenture: 2, documentsOnly: 3 },
      activeUsers: 60,
      promotionCode: null,
    }), DEFAULT_PRICING_CONFIG, null);
    expect(quote.included.fullCompanies).toBe(4);
    expect(quote.included.includedUsers).toBe(60);
    expect(quote.breakdown.groupCompaniesMonthly).toBe(250);
    expect(quote.breakdown.jointVentureCompaniesMonthly).toBe(500);
    expect(quote.breakdown.documentsOnlyCompaniesMonthly).toBe(300);
    expect(quote.breakdown.additionalUsersMonthly).toBe(0);
    expect(quote.standardMonthly).toBe(3_550);
  });

  it.each([
    [15, 0, 0],
    [16, 1, 350],
    [25, 1, 350],
    [26, 2, 700],
  ])("rounds %i active users to %i additional packs", (activeUsers, packs, monthly) => {
    const quote = calculatePricing(request({ activeUsers, promotionCode: null }), DEFAULT_PRICING_CONFIG, null);
    expect(quote.users.packs).toBe(packs);
    expect(quote.breakdown.additionalUsersMonthly).toBe(monthly);
  });

  it("prices only active projects above the included ERP project", () => {
    const quote = calculatePricing(request({ activeProjects: 5, promotionCode: null }), DEFAULT_PRICING_CONFIG, null);
    expect(quote.breakdown.additionalProjectsMonthly).toBe(1_000);
    expect(quote.standardMonthly).toBe(3_500);
  });

  it.each([
    ["basicProjects", 650, 1_300, 15_600],
    ["largeProjects", 1_300, 2_600, 31_200],
    ["villageProjects", 2_600, 5_200, 62_400],
  ] as const)("prices %s for both supported terms", (type, monthly24, monthly12, total) => {
    const base: PricingRequest = request({ productMode: "ROZARIS_ONLY", activeProjects: 0, promotionCode: null, rozaris: { [type]: 1 } });
    const quote24 = calculatePricing(base, DEFAULT_PRICING_CONFIG, null);
    const quote12 = calculatePricing({ ...base, contractMonths: 12 }, DEFAULT_PRICING_CONFIG, null);
    expect(quote24.standardMonthly).toBe(monthly24);
    expect(quote12.standardMonthly).toBe(monthly12);
    expect(quote24.contract.preIndexationValue).toBe(total);
    expect(quote12.contract.preIndexationValue).toBe(total);
  });

  it("sums multiple ROZARIS projects and starts billing them in month one", () => {
    const quote = calculatePricing(request({
      rozaris: { basicProjects: 2, largeProjects: 1, villageProjects: 1 },
    }), DEFAULT_PRICING_CONFIG, DEFAULT_LAUNCH_PROMOTION);
    expect(quote.breakdown.rozarisMonthly).toBe(5_200);
    expect(quote.promotionalSchedule[0]).toMatchObject({ fromMonth: 1, rozarisMonthly: 5_200, totalMonthly: 5_200 });
  });

  it("applies the 24-month launch offer only to NESTO ERP", () => {
    const quote = calculatePricing(request({ rozaris: { largeProjects: 1 } }), DEFAULT_PRICING_CONFIG, DEFAULT_LAUNCH_PROMOTION);
    expect(quote.promotion.applied).toBe(true);
    expect(quote.promotionalSchedule).toEqual([
      { fromMonth: 1, toMonth: 3, nestoMonthly: 0, rozarisMonthly: 1_300, totalMonthly: 1_300, discountPercent: 100 },
      { fromMonth: 4, toMonth: 6, nestoMonthly: 1_250, rozarisMonthly: 1_300, totalMonthly: 2_550, discountPercent: 50 },
      { fromMonth: 7, toMonth: 24, nestoMonthly: 2_500, rozarisMonthly: 1_300, totalMonthly: 3_800, discountPercent: 0 },
    ]);
    expect(quote.contract.preIndexationValue).toBe(79_950);
  });

  it("does not apply the launch offer to a 12-month term", () => {
    const quote = calculatePricing(request({ contractMonths: 12 }), DEFAULT_PRICING_CONFIG, DEFAULT_LAUNCH_PROMOTION);
    expect(quote.promotion.applied).toBe(false);
    expect(quote.promotionalSchedule).toHaveLength(1);
    expect(quote.contract.preIndexationValue).toBe(30_000);
  });

  it("can apply a configured promotion to a ROZARIS-only plan", () => {
    const promotion = {
      ...DEFAULT_LAUNCH_PROMOTION,
      code: "ROZARIS_12",
      product: "ROZARIS_ONLY" as const,
      requiredContractMonths: 12 as const,
      periods: [{ months: 2, discountPercent: 50 }],
    };
    const quote = calculatePricing(request({
      productMode: "ROZARIS_ONLY",
      activeProjects: 0,
      contractMonths: 12,
      promotionCode: promotion.code,
      rozaris: { basicProjects: 1 },
    }), DEFAULT_PRICING_CONFIG, promotion);
    expect(quote.promotionalSchedule[0]).toMatchObject({ fromMonth: 1, toMonth: 2, rozarisMonthly: 650, totalMonthly: 650 });
    expect(quote.contract.preIndexationValue).toBe(14_300);
  });

  it("matches the ARMAAR-like commercial example", () => {
    const quote = calculatePricing(request({
      companies: { additionalGroup: 8 },
      activeProjects: 11,
      activeUsers: 135,
      rozaris: { largeProjects: 1 },
    }), DEFAULT_PRICING_CONFIG, DEFAULT_LAUNCH_PROMOTION);
    expect(quote.nestoMonthly).toBe(7_000);
    expect(quote.standardMonthly).toBe(8_300);
    expect(quote.promotionalSchedule.map((period) => period.totalMonthly)).toEqual([1_300, 4_800, 8_300]);
    expect(quote.contract.preIndexationValue).toBe(167_700);
  });

  it("does not charge the ERP base or project add-on in ROZARIS-only mode", () => {
    const quote = calculatePricing(request({
      productMode: "ROZARIS_ONLY",
      activeProjects: 500,
      rozaris: { basicProjects: 1 },
    }), DEFAULT_PRICING_CONFIG, DEFAULT_LAUNCH_PROMOTION);
    expect(quote.breakdown.basePlatformMonthly).toBe(0);
    expect(quote.breakdown.additionalProjectsMonthly).toBe(0);
    expect(quote.standardMonthly).toBe(650);
    expect(quote.promotion.applied).toBe(false);
  });

  it("rejects unsafe or invalid public inputs", () => {
    expect(pricingRequestSchema.safeParse(request({ activeUsers: 0 })).success).toBe(false);
    expect(pricingRequestSchema.safeParse(request({ activeProjects: 0 })).success).toBe(false);
    expect(pricingRequestSchema.safeParse(request({ activeUsers: 100_001 })).success).toBe(false);
    expect(pricingRequestSchema.safeParse(request({ companies: { additionalGroup: -1 } })).success).toBe(false);
  });
});
