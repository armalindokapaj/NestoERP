import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { engineeringEn } from "./en";

export type EngineeringLabelGroup = keyof typeof engineeringEn.labels;

/**
 * A stored Engineering value's word in the reader's language. The config keeps
 * its English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function engineeringLabel(
  t: Translate<"engineering">,
  group: EngineeringLabelGroup,
  value: string | number,
  fallback: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"engineering">;
  const text = t(key);
  return text === key ? fallback : text;
}
