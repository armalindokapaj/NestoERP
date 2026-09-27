import { createTranslator, type MessageKey, type Translate } from "@/lib/i18n/translator";

import { contractsEn } from "./en";

export type ContractsLabelGroup = keyof typeof contractsEn.labels;

/** Contracts' strings in English, for pure helpers called without a reader's `t`. */
export const englishContracts: Translate<"contracts"> = createTranslator("en", contractsEn);

/**
 * A stored Contracts value's word in the reader's language. The config keeps
 * its English labels; `fallback` (that English label, or the value) shows for a
 * value the dictionary does not know.
 */
export function contractsLabel(
  t: Translate<"contracts">,
  group: ContractsLabelGroup,
  value: string,
  fallback?: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"contracts">;
  const text = t(key);
  return text === key ? (fallback ?? value) : text;
}
