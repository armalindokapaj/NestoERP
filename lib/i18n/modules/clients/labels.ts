import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { clientsEn } from "./en";

export type ClientsLabelGroup = keyof typeof clientsEn.labels;

/**
 * A stored Clients value's word in the reader's language. The config keeps its
 * English labels; `fallback` (that English label) shows for a value the
 * dictionary does not know.
 */
export function clientsLabel(t: Translate<"clients">, group: ClientsLabelGroup, value: string, fallback: string): string {
  const key = `labels.${group}.${value}` as MessageKey<"clients">;
  const text = t(key);
  return text === key ? fallback : text;
}
