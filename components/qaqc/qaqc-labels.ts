import type { qaqcEn } from "@/lib/i18n/modules/qaqc/en";
import type { MessageKey, Translate } from "@/lib/i18n/translator";

/** The groups of stored values QA/QC names on screen (`labels.<group>.<VALUE>`). */
export type QaqcLabelGroup = keyof typeof qaqcEn.labels;

/**
 * A stored value's label, in the reader's language — for server and client
 * alike (pure; no directive). The configuration keeps its English labels; the
 * dictionary names the same values. An unknown value falls back to `fallback`,
 * or the value itself.
 */
export function qaqcLabel(
  t: Translate<"qaqc">,
  group: QaqcLabelGroup,
  value: string,
  fallback?: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"qaqc">;
  const text = t(key);
  return text === key ? (fallback ?? value) : text;
}
