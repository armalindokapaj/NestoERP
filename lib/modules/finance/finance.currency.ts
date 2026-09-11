/**
 * Supported currencies (PRD #15 §29, §207).
 *
 * A static allowlist rather than "any three uppercase letters": V0.1 has no FX
 * engine, so a currency nobody can report on is not a currency this product
 * should accept (PRD #15 §36).
 */
export const SUPPORTED_CURRENCIES = [
  "EUR",
  "ALL",
  "USD",
  "GBP",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "RON",
  "RSD",
  "MKD",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: CurrencyCode = "EUR";

export function isSupportedCurrency(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Formats an amount for display.
 *
 * The amount arrives as a decimal string and is handed to `Intl` unchanged, so
 * the only thing a float ever touches is the pixels (PRD #15 §302).
 */
export function formatAmount(amount: string, currency: string, locale = "en-GB"): string {
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unknown code must not take the page down with it.
    return `${amount} ${currency}`;
  }
}

export const currencyOptions = SUPPORTED_CURRENCIES.map((code) => ({
  value: code,
  label: code,
}));
