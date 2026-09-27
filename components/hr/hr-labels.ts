import type { hrEn } from "@/lib/i18n/modules/hr/en";
import type { MessageKey, Translate } from "@/lib/i18n/translator";

/** The groups of stored values HR names on screen (`labels.<group>.<VALUE>`). */
export type HrLabelGroup = keyof typeof hrEn.labels;

/**
 * A stored value's label, in the reader's language — for server and client
 * alike (pure; no directive). The configuration keeps its English labels; the
 * dictionary names the same values. An unknown value falls back to `fallback`,
 * or the value itself.
 */
export function hrLabel(
  t: Translate<"hr">,
  group: HrLabelGroup,
  value: string,
  fallback?: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"hr">;
  const text = t(key);
  return text === key ? (fallback ?? value) : text;
}
