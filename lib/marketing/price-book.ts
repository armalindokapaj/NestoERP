import type { Locale } from "@/lib/i18n/config";
import { numberText } from "@/lib/i18n/format";
import { MODULE_GROUPS } from "@/lib/modules/pricing/pricing.config";
import { calculatePricing, isIncluded, isOffered } from "@/lib/modules/pricing/pricing.engine";
import type { PricingConfig, PricingPromotionConfig, PublicPricingConfig } from "@/lib/modules/pricing/pricing.types";

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

export type PriceRowKey = "platform" | "modules" | "modulesPerUser" | "company" | "project" | "users" | "rozaris";

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
    // A base only where the book charges one: with modules priced per person there is none.
    if (platform.baseMonthlyCents > 0) {
      rows.push({
        key: "platform",
        monthlyCents: platform.baseMonthlyCents,
        from: false,
        values: { companies: companies.included, projects: config.nestoProjects.included, users: config.nestoIncludedUsers },
      });
    }
    // The modules a Platform buyer chooses, quoted from the cheapest (docs/pricing-modules.md).
    const priced = platformModules(config).filter((row) => !row.included);
    const perUser = priced.filter((row) => row.perUserCents > 0);
    if (perUser.length > 0) {
      rows.push({ key: "modulesPerUser", monthlyCents: Math.min(...perUser.map((row) => row.perUserCents)), from: true, values: { n: priced.length, companies: companies.included, projects: config.nestoProjects.included } });
    } else if (priced.length > 0) {
      rows.push({ key: "modules", monthlyCents: Math.min(...priced.map((row) => row.monthlyCents)), from: true, values: { n: priced.length } });
    }
    if (companies.additionalAvailable) {
      rows.push({ key: "company", monthlyCents: companies.fullGroupMonthlyCents, from: false, values: { users: companies.includedUsersPerFullCompany } });
    }
    rows.push({ key: "project", monthlyCents: config.nestoProjects.additionalMonthlyCents, from: false, values: {} });
    if (users && users.pricePerPackCents > 0) rows.push({ key: "users", monthlyCents: users.pricePerPackCents, from: false, values: { n: users.packSize } });
  }

  if (config.foundations.some((row) => row.id === "ROZARIS")) {
    const smallest = Object.values(config.rozaris.classes).sort((a, b) => a.monthly24Cents - b.monthly24Cents)[0];
    if (smallest) rows.push({ key: "rozaris", monthlyCents: smallest.monthly24Cents, from: true, values: { users: smallest.includedUsers, months: 24 } });
  }

  return rows;
}

/** The launch offer on the NESTO Platform, if one is running. */
export function platformOffer(config: PublicPricingConfig): PricingPromotionConfig | null {
  return config.promotions.find((promotion) => promotion.enabled && promotion.product === "NESTO_PLATFORM" && promotion.periods.length > 0) ?? null;
}

/**
 * A sample monthly estimate for an applicant: the Platform with the modules
 * most developers start with, for their projects and the people who will sign
 * in, on 24 months before any offer. The proposal is the real figure; this
 * only stops the form being silent about money.
 */
export function sampleEstimateCents(config: PublicPricingConfig, projects: number, people: number): number | null {
  if (!config.foundations.some((row) => row.id === "NESTO_PLATFORM")) return null;
  const priced = platformModules(config).filter((row) => !row.included).map((row) => row.id);
  const quote = calculatePricing(
    { foundation: "NESTO_PLATFORM", modules: DEVELOPER.filter((id) => priced.includes(id)), companies: { fullGroup: 0, jointVenture: 0, documentsOnly: 0 }, nestoProjects: { active: Math.max(1, projects) }, rozarisProjects: [], activeUsers: Math.max(1, people), contractMonths: 24, promotionCode: null },
    engineBook(config),
    null,
  );
  return quote.standardMonthlyCents;
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
    companies: config.companies, nestoProjects: config.nestoProjects, nestoIncludedUsers: config.nestoIncludedUsers,
    rozaris: config.rozaris, users: config.users, indexation: config.indexation,
  };
}

/** A module as the site quotes it: a flat price a month, a price for each person a month, or free (`included`). */
export type ModuleLine = { id: string; name: string; short: string; group: string; monthlyCents: number; perUserCents: number; included: boolean };

/** Every module a NESTO Platform buyer can have: in the base, or priced on its own, in the catalogue's order. */
export function platformModules(config: PublicPricingConfig): ModuleLine[] {
  return config.modules
    .filter((row) => row.enabled && row.public && (isIncluded(row, "NESTO_PLATFORM") || isOffered(row, "NESTO_PLATFORM")))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => {
      const included = isIncluded(row, "NESTO_PLATFORM");
      return { id: row.id, name: row.name, short: row.shortDescription, group: row.group, monthlyCents: included ? 0 : row.monthlyPriceCents, perUserCents: included ? 0 : row.monthlyPerUserCents, included };
    });
}

/** The modules by their catalogue group, groups in the catalogue's order, empty groups left out. */
export function moduleGroups(config: PublicPricingConfig): { group: string; modules: ModuleLine[] }[] {
  const lines = platformModules(config);
  const order = [...MODULE_GROUPS, ...new Set(lines.map((row) => row.group))];
  return [...new Set(order)].map((group) => ({ group, modules: lines.filter((row) => row.group === group) })).filter((entry) => entry.modules.length > 0);
}

export type PriceExampleKey = "sales" | "developer" | "everything" | "group";
export type PriceExample = { key: PriceExampleKey; modules: string[]; companies: number; projects: number; users: number; monthlyCents: number };


/**
 * What a few typical buyers pay a month on 24 months, before any offer,
 * worked out by the same engine as the configurator. An example whose modules
 * the book does not sell is left out.
 */
export function priceExamples(config: PublicPricingConfig): PriceExample[] {
  const book = engineBook(config);
  const priced = platformModules(config).filter((row) => !row.included).map((row) => row.id);
  if (!config.foundations.some((row) => row.id === "NESTO_PLATFORM") || priced.length === 0) return [];
  const cases: Omit<PriceExample, "monthlyCents">[] = [
    { key: "sales", modules: ["SALES"], companies: 1, projects: 1, users: 15 },
    { key: "developer", modules: DEVELOPER, companies: 1, projects: 1, users: 15 },
    { key: "everything", modules: priced, companies: 1, projects: 1, users: 15 },
    { key: "group", modules: DEVELOPER, companies: 3, projects: 3, users: 25 },
  ];
  return cases
    .filter((entry) => entry.modules.every((id) => priced.includes(id)))
    .map((entry) => {
      const quote = calculatePricing(
        { foundation: "NESTO_PLATFORM", modules: entry.modules, companies: { fullGroup: entry.companies - 1, jointVenture: 0, documentsOnly: 0 }, nestoProjects: { active: entry.projects }, rozarisProjects: [], activeUsers: entry.users, contractMonths: 24, promotionCode: null },
        book,
        null,
      );
      return { ...entry, monthlyCents: quote.standardMonthlyCents };
    });
}
