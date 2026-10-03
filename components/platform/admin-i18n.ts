import type { MessageKey, MessageValues, Translate } from "@/lib/i18n/translator";

/**
 * A dictionary entry looked up by a path that is built at run time (a tab's
 * href, a status, an action key). The translator returns the path itself for a
 * key it does not have, so a missing entry falls back to the English text the
 * data carried rather than showing a dotted key.
 */
export function adminText(t: Translate<"admin">, path: string, fallback: string, values?: MessageValues): string {
  const text = t(path as MessageKey<"admin">, values);
  return text === path ? fallback : text;
}
