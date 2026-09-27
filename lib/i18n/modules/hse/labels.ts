import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { hseEn } from "./en";

export type HseLabelGroup = keyof typeof hseEn.labels;

/**
 * A stored HSE value's word in the reader's language. The config keeps its
 * English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function hseLabel(
  t: Translate<"hse">,
  group: HseLabelGroup,
  value: string | number,
  fallback: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"hse">;
  const text = t(key);
  return text === key ? fallback : text;
}
