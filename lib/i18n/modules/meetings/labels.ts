import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { meetingsEn } from "./en";

export type MeetingsLabelGroup = keyof typeof meetingsEn.labels;

/**
 * A stored Meetings value's word in the reader's language. The config keeps its
 * English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function meetingsLabel(
  t: Translate<"meetings">,
  group: MeetingsLabelGroup,
  value: string | number,
  fallback: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"meetings">;
  const text = t(key);
  return text === key ? fallback : text;
}
