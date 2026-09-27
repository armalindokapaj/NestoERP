import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { timesheetsEn } from "./en";

export type TimesheetsLabelGroup = keyof typeof timesheetsEn.labels;

/**
 * A stored value's word in the reader's language. The config keeps its English
 * labels; `fallback` (that English label) shows for a value the dictionary
 * does not know.
 */
export function timesheetsLabel(t: Translate<"timesheets">, group: TimesheetsLabelGroup, value: string | number, fallback: string): string {
  const key = `labels.${group}.${value}` as MessageKey<"timesheets">;
  const text = t(key);
  return text === key ? fallback : text;
}
