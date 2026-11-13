import type { Locale } from "@/lib/i18n/config";
import { numberText } from "@/lib/i18n/format";
import { MODULE_GROUPS } from "@/lib/modules/pricing/pricing.config";
import { calculatePricing, isIncluded, isOffered, offersGroup } from "@/lib/modules/pricing/pricing.engine";
import type { CustomerType, PricingConfig, PricingPromotionConfig, PublicPricingConfig, RozarisClass } from "@/lib/modules/pricing/pricing.types";

/**
 * The public price book as a bill of quantities (UI-05 §3.5).
 *
 * Read from the live price book, never written down: the home page, the
 * pricing page and the application's sample estimate all quote these rows, so
 * a rate changed by the Platform Admin changes everywhere at once and no page
 * can show a stale figure.
 */

/** The modules most developers start with: the examples and the apply form's sample estimate. */
const DEVELOPER = ["SALES", "FINANCE", "PROJECT_MANAGEMENT", "PROCUREMENT"];

export type PriceRowKey = "minimum" | "platform" | "companyModules" | "companyUsers" | "group" | "groupUsers" | "jointVenture" | "documentsOnly" | "project" | "users" | "rozaris";

export type PriceRow = {
  key: PriceRowKey;
  monthlyCents: number;
  /** ROZARIS is quoted "from" its smallest class. */
  from: boolean;
  /** Values for the row's words: included counts, pack size, contract length. */
  values: Record<string, number>;
};

export function priceRows(config: PublicPricingConfig): PriceRow[] {
  const rows: PriceRow[] = [];
  const platform = config.foundations.find((row) => row.id === "NESTO_PLATFORM");
  const companies = config.companies.NESTO_PLATFORM;
  const users = config.users.find((rule) => rule.foundation === "NESTO_PLATFORM");

  if (platform) {
    // The least a Platform setup is charged a month; everything below counts towards it.
    if (platform.minimumMonthlyCents > 0) rows.push({ key: "minimum", monthlyCents: platform.minimumMonthlyCents, from: false, values: {} });
    // A base only where the book charges one: with modules priced per person there is none.
    if (platform.baseMonthlyCents > 0) {
      rows.push({
        key: "platform",
        monthlyCents: platform.baseMonthlyCents,
        from: false,
        values: { companies: companies.included, projects: config.nestoProjects.included, users: config.nestoIncludedUsers },
      });
    }
    // A company: the modules it chooses, each a month and for each user, quoted from the cheapest (docs/pricing-modules.md).
    const priced = platformModules(config).filter((row) => !row.included);
    const monthly = priced.filter((row) => row.monthlyCents > 0);
    const perUser = priced.filter((row) => row.perUserCents > 0);
    const minUsers = config.customers.company.minUsers;
    if (monthly.length > 0) rows.push({ key: "companyModules", monthlyCents: Math.min(...monthly.map((row) => row.monthlyCents)), from: true, values: { n: priced.length, users: minUsers } });
    if (perUser.length > 0) rows.push({ key: "companyUsers", monthlyCents: Math.min(...perUser.map((row) => row.perUserCents)), from: true, values: {} });
    // A group: every module in one price, for each company and each user; joint ventures and documents-only companies at their own.
    if (offersGroup(config)) {
      const group = config.customers.group;
      rows.push({ key: "group", monthlyCents: group.perCompanyCents, from: false, values: { companies: group.minCompanies, users: group.minUsers } });
      if (group.perUserCents > 0) rows.push({ key: "groupUsers", monthlyCents: group.perUserCents, from: false, values: {} });
      if (companies.jointVentureMonthlyCents > 0) rows.push({ key: "jointVenture", monthlyCents: companies.jointVentureMonthlyCents, from: false, values: {} });
      if (companies.documentsOnlyMonthlyCents > 0) rows.push({ key: "documentsOnly", monthlyCents: companies.documentsOnlyMonthlyCents, from: false, values: {} });
    }
    rows.push({ key: "project", monthlyCents: config.nestoProjects.additionalMonthlyCents, from: false, values: { included: config.nestoProjects.included } });
    if (users && users.pricePerPackCents > 0) rows.push({ key: "users", monthlyCents: users.pricePerPackCents, from: false, values: { n: users.packSize } });
  }

  if (config.foundations.some((row) => row.id === "ROZARIS")) {
    const smallest = Object.values(config.rozaris.classes).sort((a, b) => a.monthly24Cents - b.monthly24Cents)[0];
    if (smallest) rows.push({ key: "rozaris", monthlyCents: smallest.monthly24Cents, from: true, values: { months: 24 } });
  }

  return rows;
}

/** The launch offer on the NESTO Platform, if one is running. */
export function platformOffer(config: PublicPricingConfig): PricingPromotionConfig | null {
  return config.promotions.find((promotion) => promotion.enabled && promotion.product === "NESTO_PLATFORM" && promotion.periods.length > 0) ?? null;
}

/**
 * A sample monthly estimate for an applicant: a company with the modules most
 * developers start with, for their projects and the people who will sign in
 * (at least the company's fewest), on 24 months before any offer. The
 * proposal is the real figure; this only stops the form being silent about money.
 */
export function sampleEstimateCents(config: PublicPricingConfig, projects: number, people: number): number | null {
  if (!config.foundations.some((row) => row.id === "NESTO_PLATFORM")) return null;
  const priced = platformModules(config).filter((row) => !row.included).map((row) => row.id);
  return platformQuote(config, { customer: "COMPANY", modules: DEVELOPER.filter((id) => priced.includes(id)), companies: 1, projects: Math.max(1, projects), users: Math.max(1, people), rozaris: [] }).standardMonthlyCents;
}

type Setup = { customer: CustomerType; modules: string[]; companies: number; projects: number; users: number; rozaris: RozarisClass[] };

/** The engine's quote for a Platform setup on 24 months, before any offer. */
function platformQuote(config: PublicPricingConfig, setup: Setup) {
  return calculatePricing(
    {
      foundation: "NESTO_PLATFORM", customer: setup.customer, modules: setup.modules,
      companies: { fullGroup: Math.max(0, setup.companies - 1), jointVenture: 0, documentsOnly: 0 },
      nestoProjects: { active: setup.projects }, rozarisProjects: setup.rozaris.map((type, index) => ({ tempId: `e${index}`, type })),
      activeUsers: setup.users, contractMonths: 24, promotionCode: null,
    },
    engineBook(config),
    null,
  );
}

/**
 * Whole euros, as the configurator writes them. Albanian is written by hand
 * (lib/i18n/format.ts): Chrome has no Albanian number data, so `Intl` would
 * answer differently in the browser and on the server.
 */
export function formatEuros(cents: number, locale: Locale): string {
  return numberText(cents / 100, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }, locale, "en");
}

/** The public book in the engine's shape, so the site quotes exactly what the configurator and the proposal charge. */
export function engineBook(config: PublicPricingConfig): PricingConfig {
  return {
    schemaVersion: 2, version: config.pricingVersion, currency: "EUR", foundations: config.foundations, modules: config.modules,
    companies: config.companies, customers: config.customers, nestoProjects: config.nestoProjects, nestoIncludedUsers: config.nestoIncludedUsers,
    rozaris: config.rozaris, users: config.users, indexation: config.indexation,
  };
}

/** A module as the site quotes it for a company, a month: its price and its price for each user — or free (`included`). */
export type ModuleLine = { id: string; name: string; short: string; group: string; monthlyCents: number; perUserCents: number; included: boolean };

/** Every module a NESTO Platform buyer can have: in the base, or priced on its own, in the catalogue's order. */
export function platformModules(config: PublicPricingConfig): ModuleLine[] {
  return config.modules
    .filter((row) => row.enabled && row.public && (isIncluded(row, "NESTO_PLATFORM") || isOffered(row, "NESTO_PLATFORM")))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => {
      const included = isIncluded(row, "NESTO_PLATFORM");
      const sold = (cents: number) => (included ? 0 : cents);
      return { id: row.id, name: row.name, short: row.shortDescription, group: row.group, monthlyCents: sold(row.monthlyPriceCents), perUserCents: sold(row.monthlyPerUserCents), included };
    });
}

/** The modules by their catalogue group, groups in the catalogue's order, empty groups left out. */
export function moduleGroups(config: PublicPricingConfig): { group: string; modules: ModuleLine[] }[] {
  const lines = platformModules(config);
  const order = [...MODULE_GROUPS, ...new Set(lines.map((row) => row.group))];
  return [...new Set(order)].map((group) => ({ group, modules: lines.filter((row) => row.group === group) })).filter((entry) => entry.modules.length > 0);
}

export type PriceExampleKey = "office" | "developer" | "seller" | "group";
/** `atMinimum`: the setup comes to less than the monthly minimum, which is what it pays. */
export type PriceExample = Setup & { key: PriceExampleKey; monthlyCents: number; atMinimum: boolean };

/**
 * What a few typical buyers pay a month on 24 months, before any offer,
 * worked out by the same engine as the configurator. An example the book does
 * not sell (its modules, a group, ROZARIS 3D) is left out.
 */
export function priceExamples(config: PublicPricingConfig): PriceExample[] {
  const priced = platformModules(config).filter((row) => !row.included).map((row) => row.id);
  if (!config.foundations.some((row) => row.id === "NESTO_PLATFORM") || priced.length === 0) return [];
  const company = config.customers.company.minUsers;
  const group = config.customers.group;
  const cases: Array<Setup & { key: PriceExampleKey }> = [
    { key: "office", customer: "COMPANY", modules: ["ARCHITECTURE", "ENGINEERING", "FINANCE", "PROJECT_MANAGEMENT"], companies: 1, projects: 1, users: Math.max(company, 10), rozaris: [] },
    { key: "developer", customer: "COMPANY", modules: DEVELOPER, companies: 1, projects: 1, users: Math.max(company, 15), rozaris: [] },
    { key: "seller", customer: "COMPANY", modules: [], companies: 1, projects: 1, users: company, rozaris: ["BASIC"] },
    { key: "group", customer: "GROUP", modules: [], companies: Math.max(group.minCompanies, 3), projects: 3, users: group.minUsers, rozaris: [] },
  ];
  const sellsRozaris = config.foundations.some((row) => row.id === "ROZARIS");
  return cases
    .filter((entry) => entry.modules.every((id) => priced.includes(id)) && (entry.customer !== "GROUP" || offersGroup(config)) && (entry.rozaris.length === 0 || sellsRozaris))
    .map((entry) => {
      const quote = platformQuote(config, entry);
      return { ...entry, monthlyCents: quote.standardMonthlyCents, atMinimum: quote.minimum.topUpCents > 0 };
    });
}
