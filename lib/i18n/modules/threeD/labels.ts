import type { MessageKey, Translate } from "@/lib/i18n/translator";

import type { threeDEn } from "./en";

export type ThreeDLabelGroup = keyof typeof threeDEn.labels;

/**
 * A stored 3D viewer value's word in the reader's language. The config keeps
 * its English labels; `fallback` shows for a value the dictionary does not know.
 */
export function threeDLabel(
  t: Translate<"threeD">,
  group: ThreeDLabelGroup,
  value: string | number,
  fallback: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"threeD">;
  const text = t(key);
  return text === key ? fallback : text;
}
