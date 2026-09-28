import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { peopleEn } from "./en";

export type PeopleLabelGroup = keyof typeof peopleEn.labels;

/**
 * A stored People value's word in the reader's language. The config keeps its
 * English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function peopleLabel(t: Translate<"people">, group: PeopleLabelGroup, value: string, fallback: string): string {
  const key = `labels.${group}.${value}` as MessageKey<"people">;
  const text = t(key);
  return text === key ? fallback : text;
}
