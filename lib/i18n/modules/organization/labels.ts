import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { organizationEn } from "./en";

export type OrganizationLabelGroup = keyof typeof organizationEn.labels;

/**
 * A stored Organization value's word in the reader's language. The
 * configuration keeps its English labels; `fallback` (that English label)
 * shows for a value the dictionary does not know.
 */
export function organizationLabel(t: Translate<"organization">, group: OrganizationLabelGroup, value: string | number, fallback: string): string {
  const key = `labels.${group}.${value}` as MessageKey<"organization">;
  const text = t(key);
  return text === key ? fallback : text;
}

/** A module's name from the frame's module names; `fallback` is the registry's English. */
export function moduleName(t: Translate<"modules">, key: string, fallback: string): string {
  const messageKey = `${key}.label` as MessageKey<"modules">;
  const text = t(messageKey);
  return text === messageKey ? fallback : text;
}
