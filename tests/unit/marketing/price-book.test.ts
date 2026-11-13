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

/** The book charged by module (docs/pricing-modules.md): a €400 base, the everyday tools in it, every other module on its own. */
const PRICES: Record<string, number> = {
  SALES: 300, FINANCE: 300, PROJECT_MANAGEMENT: 250, PROCUREMENT: 200, HR: 150, LEGAL_FULL: 150, LEGAL_DOCUMENTS: 50,
  ARCHITECTURE: 100, ENGINEERING: 100, HSE: 100, INVENTORY: 100, CONTRACTORS: 100,
};
const byModule: PublicPricingConfig = {
  ...config,
  foundations: config.foundations.map((row) => (row.id === "NESTO_PLATFORM" ? { ...row, baseMonthlyCents: 40_000 } : row)),
  companies: { ...config.companies, NESTO_PLATFORM: { ...config.companies.NESTO_PLATFORM, fullGroupMonthlyCents: 25_000 } },
  nestoProjects: { ...config.nestoProjects, additionalMonthlyCents: 20_000 },
  users: config.users.map((rule) => (rule.foundation === "NESTO_PLATFORM" ? { ...rule, pricePerPackCents: 30_000 } : rule)),
  modules: config.modules.map((row) => (row.id in PRICES ? { ...row, monthlyPriceCents: PRICES[row.id]! * 100, includedInFoundations: row.includedInFoundations.filter((id) => id !== "NESTO_PLATFORM") } : row)),
};

describe("price book charged by module", () => {
  it("adds a modules row quoted from the cheapest module, and none while every module is in the base", () => {
    expect(priceRows(byModule).find((row) => row.key === "modules")).toMatchObject({ from: true, monthlyCents: 5_000, values: { n: 12 } });
    expect(priceRows(config).some((row) => row.key === "modules")).toBe(false);
  });

  it("lists every module by group, the everyday tools in the base", () => {
    const groups = moduleGroups(byModule);
    expect(groups.map((entry) => entry.group)).toEqual(["Commercial", "Corporate / Control", "Delivery", "Operations", "Collaboration / Support"]);
    const lines = groups.flatMap((entry) => entry.modules);
    expect(lines.find((row) => row.id === "SALES")).toMatchObject({ included: false, monthlyCents: 30_000 });
    expect(lines.find((row) => row.id === "DAILY_LOG")).toMatchObject({ included: true, monthlyCents: 0 });
    expect(lines.some((row) => row.id === "DOCUMENTS_CORE")).toBe(false);
  });

  it("works out what typical buyers pay with the configurator's engine", () => {
    const examples = Object.fromEntries(priceExamples(byModule).map((example) => [example.key, example.monthlyCents]));
    expect(examples).toEqual({ sales: 70_000, developer: 145_000, everything: 225_000, group: 235_000 });
    expect(priceExamples(config)).toEqual([]);
  });
});

/** The book with modules priced for each person (docs/pricing-modules.md): no base, no included or packed users. */
const PER_PERSON: Record<string, number> = {
  SALES: 28, FINANCE: 28, PROJECT_MANAGEMENT: 24, PROCUREMENT: 18, HR: 14, LEGAL_FULL: 14, LEGAL_DOCUMENTS: 5,
  ARCHITECTURE: 9, ENGINEERING: 9, HSE: 9, INVENTORY: 9, CONTRACTORS: 9,
};
const perPerson: PublicPricingConfig = {
  ...byModule,
  foundations: byModule.foundations.map((row) => (row.id === "NESTO_PLATFORM" ? { ...row, baseMonthlyCents: 0 } : row)),
  companies: { ...byModule.companies, NESTO_PLATFORM: { ...byModule.companies.NESTO_PLATFORM, includedUsersPerFullCompany: 0 } },
  nestoIncludedUsers: 0,
  users: byModule.users.map((rule) => (rule.foundation === "NESTO_PLATFORM" ? { ...rule, pricePerPackCents: 0 } : rule)),
  modules: byModule.modules.map((row) => (row.id in PER_PERSON ? { ...row, monthlyPriceCents: 0, monthlyPerUserCents: PER_PERSON[row.id]! * 100 } : row)),
};

describe("price book with modules priced for each person", () => {
  it("drops the base and the user packs, and quotes modules per person from the cheapest", () => {
    const rows = priceRows(perPerson);
    expect(rows.map((row) => row.key)).toEqual(["modulesPerUser", "company", "project", "rozaris"]);
    expect(rows[0]).toMatchObject({ from: true, monthlyCents: 500, values: { n: 12, companies: 1, projects: 1 } });
  });

  it("lists each module's rate per person, the everyday tools free", () => {
    const lines = moduleGroups(perPerson).flatMap((entry) => entry.modules);
    expect(lines.find((row) => row.id === "SALES")).toMatchObject({ included: false, monthlyCents: 0, perUserCents: 2_800 });
    expect(lines.find((row) => row.id === "MEETINGS")).toMatchObject({ included: true, perUserCents: 0 });
  });

  it("works out the examples and the sample estimate for people × modules", () => {
    const examples = Object.fromEntries(priceExamples(perPerson).map((example) => [example.key, example.monthlyCents]));
    expect(examples).toEqual({ sales: 42_000, developer: 147_000, everything: 256_500, group: 335_000 });
    expect(sampleEstimateCents(perPerson, 1, 15)).toBe(147_000);
  });
});
