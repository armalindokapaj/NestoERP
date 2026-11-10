import type { Locale } from "@/lib/i18n/config";
import { numberText } from "@/lib/i18n/format";
import type { PricingPromotionConfig, PublicPricingConfig } from "@/lib/modules/pricing/pricing.types";

/**
 * The public price book as a bill of quantities (UI-05 §3.5).
 *
 * Read from the live price book, never written down: the home page, the
 * pricing page and the application's sample estimate all quote these rows, so
 * a rate changed by the Platform Admin changes everywhere at once and no page
 * can show a stale figure.
 */

export type PriceRowKey = "platform" | "company" | "project" | "users" | "rozaris";

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
    rows.push({
      key: "platform",
      monthlyCents: platform.baseMonthlyCents,
      from: false,
      values: { companies: companies.included, projects: config.nestoProjects.included, users: config.nestoIncludedUsers },
    });
    if (companies.additionalAvailable) {
      rows.push({ key: "company", monthlyCents: companies.fullGroupMonthlyCents, from: false, values: { users: companies.includedUsersPerFullCompany } });
    }
    rows.push({ key: "project", monthlyCents: config.nestoProjects.additionalMonthlyCents, from: false, values: {} });
    if (users) rows.push({ key: "users", monthlyCents: users.pricePerPackCents, from: false, values: { n: users.packSize } });
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
 * A sample monthly estimate for an applicant: the Platform for their projects
 * and the people who will sign in, before any offer. The proposal is the real
 * figure; this only stops the form being silent about money.
 */
export function sampleEstimateCents(config: PublicPricingConfig, projects: number, people: number): number | null {
  const platform = config.foundations.find((row) => row.id === "NESTO_PLATFORM");
  const users = config.users.find((rule) => rule.foundation === "NESTO_PLATFORM");
  if (!platform || !users) return null;
  const extraProjects = Math.max(0, projects - config.nestoProjects.included);
  const extraPacks = Math.ceil(Math.max(0, people - config.nestoIncludedUsers) / users.packSize);
  return platform.baseMonthlyCents + extraProjects * config.nestoProjects.additionalMonthlyCents + extraPacks * users.pricePerPackCents;
}

/**
 * Whole euros, as the configurator writes them. Albanian is written by hand
 * (lib/i18n/format.ts): Chrome has no Albanian number data, so `Intl` would
 * answer differently in the browser and on the server.
 */
export function formatEuros(cents: number, locale: Locale): string {
  return numberText(cents / 100, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }, locale, "en");
}
