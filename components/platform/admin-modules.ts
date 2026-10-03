import type { MessageKey, Translate } from "@/lib/i18n/translator";

/**
 * A module's name or description in the reader's language, from the application
 * dictionary (`modules.<key>.label` / `.description`). A key the dictionary
 * does not have returns the English text the data carried.
 */
export function adminModuleText(t: Translate<"modules">, key: string, field: "label" | "description", fallback: string): string {
  const path = `${key}.${field}`;
  const text = t(path as MessageKey<"modules">);
  return text === path ? fallback : text;
}
