import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { dailyLogsEn } from "./en";

export type DailyLogsLabelGroup = keyof typeof dailyLogsEn.labels;

/**
 * A stored value's word in the reader's language. The config keeps its English
 * labels; `fallback` (that English label) shows for a value the dictionary
 * does not know.
 */
export function dailyLogsLabel(t: Translate<"dailyLogs">, group: DailyLogsLabelGroup, value: string | number, fallback: string): string {
  const key = `labels.${group}.${value}` as MessageKey<"dailyLogs">;
  const text = t(key);
  return text === key ? fallback : text;
}
