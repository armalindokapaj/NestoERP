import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { calendarEn } from "./en";

export type CalendarLabelGroup = keyof typeof calendarEn.labels;

/**
 * A stored Calendar value's word in the reader's language. The view model
 * keeps its English labels; `fallback` (that English label) shows for a value
 * the dictionary does not know.
 */
export function calendarLabel(t: Translate<"calendar">, group: CalendarLabelGroup, value: string | number, fallback: string): string {
  const key = `labels.${group}.${value}` as MessageKey<"calendar">;
  const text = t(key);
  return text === key ? fallback : text;
}
