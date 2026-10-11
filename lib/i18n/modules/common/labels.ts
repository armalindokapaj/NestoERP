import type { ModuleKey, ModuleSectionConfig } from "@/config/modules";
import type { MessageKey, Translate } from "@/lib/i18n/translator";
import { SORT_WORDS, type SortWords } from "@/lib/tables/sort";
import { statusLabel } from "@/lib/utils/status";

import { commonEn } from "./en";

/**
 * The labels every page shows, in the reader's language: module tabs, status
 * words, record nouns, the Support shell and the Sort select's directions.
 *
 * Configuration, registries and services keep their English, and nothing here
 * recomputes it: each helper looks a key up and, where the dictionary has no
 * entry, returns the English it was handed. Pure, so a Server Component passes
 * `await getTranslations("common")` and a Client Component its hook's `t`.
 */

/**
 * A module tab's label. A section resolved to its self-service name ("My
 * leave" rather than "Leave", lib/access/module-access.ts) reads from
 * `moduleSelfSections`; a tab the dictionary does not know keeps its
 * configured label.
 */
export function sectionLabel(
  t: Translate<"common">,
  moduleKey: ModuleKey,
  section: Pick<ModuleSectionConfig, "key" | "label" | "selfLabel">,
): string {
  const group = section.selfLabel !== undefined && section.label === section.selfLabel ? "moduleSelfSections" : "moduleSections";
  const key = `${group}.${moduleKey}.${section.key}` as MessageKey<"common">;
  const text = t(key);
  return text === key ? section.label : text;
}

/**
 * A stored status or priority value as text, for an aria-label or a joined
 * string; `StatusText` renders the same thing. An unknown value keeps its
 * English label.
 */
export function statusText(t: Translate<"common">, status: string): string {
  const key = `status.${status}` as MessageKey<"common">;
  const text = t(key);
  return text === key ? statusLabel(status) : text;
}

/** A record type's noun ("Invoice", "Leave request"); `fallback` is the registry's English noun. */
export function recordTypeName(t: Translate<"common">, type: string, fallback: string): string {
  const key = `recordTypes.${type}` as MessageKey<"common">;
  const text = t(key);
  return text === key ? fallback : text;
}

/** Every string under a dictionary branch, with its dotted path. */
function leaves(branch: object, prefix: string): [path: string, text: string][] {
  return Object.entries(branch).flatMap(([key, value]): [string, string][] =>
    typeof value === "string" ? [[`${prefix}.${key}`, value]] : leaves(value, `${prefix}.${key}`),
  );
}

const SUPPORT_SHELL_KEYS = new Map(
  leaves(commonEn.supportShell, "supportShell").map(([path, text]) => [text, path as MessageKey<"common">]),
);

/**
 * The Support request shell's wording. Its registry
 * (lib/modules/records/registry.ts) hands the pages English labels rather than
 * keys, so a label is found by its English text; anything the dictionary does
 * not hold passes through unchanged.
 */
export function supportShellText(t: Translate<"common">, text: string): string {
  const key = SUPPORT_SHELL_KEYS.get(text);
  if (!key) return text;
  const translated = t(key);
  return translated === key ? text : translated;
}

/** The Sort select's direction phrases, as `sortChoices` takes them. */
export function sortWords(t: Translate<"common">): SortWords {
  const words = { ...SORT_WORDS };
  for (const word of Object.keys(SORT_WORDS) as (keyof SortWords)[]) {
    const key = `sort.${word}` as const;
    const text = t(key);
    if (text !== key) words[word] = text;
  }
  return words;
}
