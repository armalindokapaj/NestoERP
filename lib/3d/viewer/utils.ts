import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Locale } from "@/lib/3d/viewer/types";

/*
 * The Rozaris formatting helpers the Project viewer uses. `cn` keeps Rozaris'
 * stock tailwind-merge (not NESTO's extended one) so the ported class lists
 * merge exactly as they do there.
 */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const PRICE_INTL_LOCALE: Record<Locale, string> = { en: "en-US", sq: "sq-AL" };

const CURRENCY_PREFIX: Record<string, string> = { EUR: "€", ALL: "L" };

/**
 * Rozaris prints EUR and ALL with a leading symbol. A NESTO unit can be priced
 * in any ISO currency; one Rozaris has no symbol for keeps its code instead.
 */
export function formatPrice(amount: number, currency: string = "EUR", opts: { compact?: boolean; locale?: Locale } = {}) {
  const intlLocale = PRICE_INTL_LOCALE[opts.locale ?? "sq"];
  const formatter = opts.compact
    ? new Intl.NumberFormat(intlLocale, { notation: "compact", maximumFractionDigits: 1 })
    : new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 });
  const prefix = CURRENCY_PREFIX[currency];
  return prefix ? `${prefix}${formatter.format(amount)}` : `${formatter.format(amount)} ${currency}`;
}

export function formatArea(area: number) {
  return `${area} m²`;
}

const TRANSACTION_LABELS: Record<Locale, { sale: string }> = {
  en: { sale: "For Sale" },
  sq: { sale: "Në Shitje" },
};

export function transactionLabel(_transaction: "sale", locale: Locale = "en") {
  return TRANSACTION_LABELS[locale].sale;
}

export function whatsappHref(phoneE164: string, message: string): string {
  const digits = phoneE164.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function telHref(phoneE164: string) {
  return `tel:${phoneE164}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
