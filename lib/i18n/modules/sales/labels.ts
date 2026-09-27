import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { salesEn } from "./en";

export type SalesLabelGroup = keyof typeof salesEn.labels;

/**
 * A stored Sales value's word in the reader's language. The config keeps its
 * English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function salesLabel(
  t: Translate<"sales">,
  group: SalesLabelGroup,
  value: string | number,
  fallback: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"sales">;
  const text = t(key);
  return text === key ? fallback : text;
}
