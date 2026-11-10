import { describe, expect, it } from "vitest";

import { DEFAULT_LAUNCH_PROMOTION, DEFAULT_PRICING_CONFIG } from "@/lib/modules/pricing/pricing.config";
import type { PublicPricingConfig } from "@/lib/modules/pricing/pricing.types";
import { formatEuros, platformOffer, priceRows, sampleEstimateCents } from "@/lib/marketing/price-book";

/** The public price book as the home page, /pricing and /apply quote it (UI-05 §3.5). */
const config: PublicPricingConfig = {
  pricingVersion: DEFAULT_PRICING_CONFIG.version,
  currency: "EUR",
  foundations: DEFAULT_PRICING_CONFIG.foundations,
  modules: DEFAULT_PRICING_CONFIG.modules,
  companies: DEFAULT_PRICING_CONFIG.companies,
  nestoProjects: DEFAULT_PRICING_CONFIG.nestoProjects,
  nestoIncludedUsers: DEFAULT_PRICING_CONFIG.nestoIncludedUsers,
  rozaris: DEFAULT_PRICING_CONFIG.rozaris,
  users: DEFAULT_PRICING_CONFIG.users,
  contractOptions: [24, 12],
  promotions: [DEFAULT_LAUNCH_PROMOTION],
  indexation: DEFAULT_PRICING_CONFIG.indexation,
};

describe("price book", () => {
  it("reads every row from the price book, never from the page", () => {
    const rows = priceRows(config);
    const platform = DEFAULT_PRICING_CONFIG.foundations.find((row) => row.id === "NESTO_PLATFORM")!;
    expect(rows.map((row) => row.key)).toEqual(["platform", "company", "project", "users", "rozaris"]);
    expect(rows[0]).toMatchObject({ monthlyCents: platform.baseMonthlyCents, values: { projects: DEFAULT_PRICING_CONFIG.nestoProjects.included, users: DEFAULT_PRICING_CONFIG.nestoIncludedUsers } });
    expect(rows[2].monthlyCents).toBe(DEFAULT_PRICING_CONFIG.nestoProjects.additionalMonthlyCents);
  });

  it("quotes ROZARIS from its smallest class on 24 months", () => {
    const rozaris = priceRows(config).find((row) => row.key === "rozaris")!;
    const smallest = Math.min(...Object.values(DEFAULT_PRICING_CONFIG.rozaris.classes).map((item) => item.monthly24Cents));
    expect(rozaris).toMatchObject({ from: true, monthlyCents: smallest, values: { months: 24 } });
  });

  it("leaves out what the price book does not sell", () => {
    const withoutRozaris = { ...config, foundations: config.foundations.filter((row) => row.id !== "ROZARIS") };
    expect(priceRows(withoutRozaris).some((row) => row.key === "rozaris")).toBe(false);
    expect(platformOffer({ ...config, promotions: [] })).toBeNull();
    expect(platformOffer(config)?.code).toBe(DEFAULT_LAUNCH_PROMOTION.code);
  });

  it("estimates an applicant's month from projects and people beyond what is included", () => {
    const base = DEFAULT_PRICING_CONFIG.foundations.find((row) => row.id === "NESTO_PLATFORM")!.baseMonthlyCents;
    const pack = DEFAULT_PRICING_CONFIG.users.find((rule) => rule.foundation === "NESTO_PLATFORM")!;
    const included = DEFAULT_PRICING_CONFIG.nestoIncludedUsers;
    expect(sampleEstimateCents(config, 1, included)).toBe(base);
    expect(sampleEstimateCents(config, 3, included + 1)).toBe(base + 2 * DEFAULT_PRICING_CONFIG.nestoProjects.additionalMonthlyCents + pack.pricePerPackCents);
  });

  it("formats whole euros", () => {
    expect(formatEuros(250_000, "en")).toBe("€2,500");
  });
});
