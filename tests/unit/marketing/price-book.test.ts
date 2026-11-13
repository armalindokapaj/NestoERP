import { describe, expect, it } from "vitest";

import { DEFAULT_LAUNCH_PROMOTION, DEFAULT_PRICING_CONFIG } from "@/lib/modules/pricing/pricing.config";
import type { PublicPricingConfig } from "@/lib/modules/pricing/pricing.types";
import { formatEuros, moduleGroups, platformOffer, priceExamples, priceRows, sampleEstimateCents } from "@/lib/marketing/price-book";

/** The public price book as the home page, /pricing and /apply quote it (UI-05 §3.5). */
const config: PublicPricingConfig = {
  pricingVersion: DEFAULT_PRICING_CONFIG.version,
  currency: "EUR",
  foundations: DEFAULT_PRICING_CONFIG.foundations,
  modules: DEFAULT_PRICING_CONFIG.modules,
  companies: DEFAULT_PRICING_CONFIG.companies,
  customers: DEFAULT_PRICING_CONFIG.customers,
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
    expect(rows.map((row) => row.key)).toEqual(["platform", "group", "groupUsers", "jointVenture", "documentsOnly", "project", "users", "rozaris"]);
    expect(rows[0]).toMatchObject({ monthlyCents: platform.baseMonthlyCents, values: { projects: DEFAULT_PRICING_CONFIG.nestoProjects.included, users: DEFAULT_PRICING_CONFIG.nestoIncludedUsers } });
    expect(rows.find((row) => row.key === "project")?.monthlyCents).toBe(DEFAULT_PRICING_CONFIG.nestoProjects.additionalMonthlyCents);
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

/** Book 2026.11.5 (docs/pricing-modules.md): a company chooses modules, a group has them all; €600 minimum. */
const RATES: Record<string, [number, number]> = {
  SALES: [150, 15], FINANCE: [150, 15], PROJECT_MANAGEMENT: [120, 12], PROCUREMENT: [100, 10], HR: [80, 8], LEGAL_FULL: [80, 8], LEGAL_DOCUMENTS: [30, 3],
  ARCHITECTURE: [50, 5], ENGINEERING: [50, 5], HSE: [50, 5], INVENTORY: [50, 5], CONTRACTORS: [50, 5],
};
const sold: PublicPricingConfig = {
  ...config,
  foundations: config.foundations.map((row) => (row.id === "NESTO_PLATFORM" ? { ...row, baseMonthlyCents: 0, minimumMonthlyCents: 60_000 } : row)),
  modules: config.modules.map((row) => {
    const rate = RATES[row.id];
    return rate ? { ...row, monthlyPriceCents: rate[0] * 100, monthlyPerUserCents: rate[1] * 100, includedInFoundations: row.includedInFoundations.filter((id) => id !== "NESTO_PLATFORM") } : row;
  }),
  companies: { ...config.companies, NESTO_PLATFORM: { ...config.companies.NESTO_PLATFORM, jointVentureMonthlyCents: 25_000, documentsOnlyMonthlyCents: 10_000, includedUsersPerFullCompany: 0 } },
  customers: { company: { minUsers: 10 }, group: { minUsers: 25, minCompanies: 2, perCompanyCents: 60_000, perUserCents: 6_000 } },
  nestoProjects: { included: 1, additionalMonthlyCents: 20_000 },
  nestoIncludedUsers: 0,
  users: config.users.map((rule) => (rule.foundation === "NESTO_PLATFORM" ? { ...rule, pricePerPackCents: 0 } : rule)),
};

describe("price book for a company or a group of companies", () => {
  it("quotes the minimum, a company's modules and users from the cheapest, the group's price, companies, projects and 3D", () => {
    const rows = priceRows(sold);
    expect(rows.map((row) => row.key)).toEqual(["minimum", "companyModules", "companyUsers", "group", "groupUsers", "jointVenture", "documentsOnly", "project", "rozaris"]);
    expect(rows.find((row) => row.key === "companyModules")).toMatchObject({ from: true, monthlyCents: 3_000, values: { n: 12, users: 10 } });
    expect(rows.find((row) => row.key === "companyUsers")).toMatchObject({ from: true, monthlyCents: 300 });
    expect(rows.find((row) => row.key === "group")).toMatchObject({ from: false, monthlyCents: 60_000, values: { companies: 2, users: 25 } });
    expect(rows.find((row) => row.key === "groupUsers")?.monthlyCents).toBe(6_000);
  });

  it("lists each module's price a month and for each user, the everyday tools free", () => {
    const lines = moduleGroups(sold).flatMap((entry) => entry.modules);
    expect(lines.find((row) => row.id === "SALES")).toMatchObject({ included: false, monthlyCents: 15_000, perUserCents: 1_500 });
    expect(lines.find((row) => row.id === "MEETINGS")).toMatchObject({ included: true, monthlyCents: 0 });
  });

  it("works out four buyers with the configurator's engine", () => {
    const examples = Object.fromEntries(priceExamples(sold).map((example) => [example.key, [example.monthlyCents, example.atMinimum]]));
    expect(examples).toEqual({
      office: [37_000 + 10 * 3_700, false],
      developer: [52_000 + 15 * 5_200, false],
      seller: [65_000, false],
      group: [3 * 60_000 + 25 * 6_000 + 2 * 20_000, false],
    });
    expect(sampleEstimateCents(sold, 1, 3)).toBe(52_000 + 10 * 5_200);
  });

  it("leaves out the group where the book prices none", () => {
    const noGroup = { ...sold, customers: { ...sold.customers, group: { ...sold.customers.group, perCompanyCents: 0, perUserCents: 0 } } };
    expect(priceRows(noGroup).some((row) => row.key.startsWith("group"))).toBe(false);
    expect(priceExamples(noGroup).map((example) => example.key)).toEqual(["office", "developer", "seller"]);
  });
});
