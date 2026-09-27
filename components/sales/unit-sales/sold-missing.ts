import { salesEn } from "@/lib/i18n/modules/sales/en";
import type { MessageKey, Translate } from "@/lib/i18n/translator";

/** The Sold rule's English "missing" items (unit-sales.rules.ts), back to their keys. */
const MISSING_KEYS = new Map(
  Object.entries(salesEn.soldMissing).map(([key, text]) => [text, `soldMissing.${key}` as MessageKey<"sales">]),
);

/** A missing Sold condition in the reader's language; an unknown item passes through. */
export function soldMissingText(t: Translate<"sales">, item: string): string {
  const key = MISSING_KEYS.get(item);
  return key ? t(key) : item;
}
