import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { contractorsEn } from "./en";

export type ContractorsLabelGroup = keyof typeof contractorsEn.labels;

/**
 * A stored Contractors value's word in the reader's language. The config keeps
 * its English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function contractorsLabel(t: Translate<"contractors">, group: ContractorsLabelGroup, value: string, fallback: string): string {
  const key = `labels.${group}.${value}` as MessageKey<"contractors">;
  const text = t(key);
  return text === key ? fallback : text;
}
