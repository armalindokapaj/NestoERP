import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { workforceEn } from "./en";

export type WorkforceLabelGroup = keyof typeof workforceEn.labels;

/**
 * A stored Workforce value's word in the reader's language. The config keeps
 * its English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function workforceLabel(
  t: Translate<"workforce">,
  group: WorkforceLabelGroup,
  value: string,
  fallback: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"workforce">;
  const text = t(key);
  return text === key ? fallback : text;
}
