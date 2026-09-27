import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { procurementEn } from "./en";

export type ProcurementLabelGroup = keyof typeof procurementEn.labels;

/**
 * A stored Procurement value's word in the reader's language. The config keeps
 * its English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function procurementLabel(
  t: Translate<"procurement">,
  group: ProcurementLabelGroup,
  value: string | number,
  fallback: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"procurement">;
  const text = t(key);
  return text === key ? fallback : text;
}
