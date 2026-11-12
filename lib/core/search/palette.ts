/**
 * The search palette's own rules (docs/ui/UI-08-search.md), client-safe and
 * framework-free so they are unit-tested on their own: its filters by kind,
 * how a page or an action matches what was typed, and where the typed text
 * sits in a title so it can be marked.
 */

import { normalise } from "./search.types";

/** The filters under the field, in order. `types` is what `/api/search?type=` asks for; Pages is the palette's own list. */
export const SEARCH_SCOPES = [
  { key: "all", types: null },
  { key: "projects", types: ["project"] },
  { key: "units", types: ["project_unit"] },
  { key: "tasks", types: ["task"] },
  { key: "people", types: ["person", "member"] },
  { key: "clients", types: ["client"] },
  { key: "documents", types: ["document", "engineering_document"] },
  { key: "pages", types: [] },
] as const satisfies ReadonlyArray<{ key: string; types: readonly string[] | null }>;

export type SearchScope = (typeof SEARCH_SCOPES)[number]["key"];

/** A record's group in the results: its filter's name where it has one (a unit is a Unit, not a Project), else its module's. */
export function groupOfType(entityType: string): SearchScope | null {
  for (const scope of SEARCH_SCOPES) if (scope.types?.some((type) => type === entityType)) return scope.key;
  return null;
}

/** The next filter, or the previous with `step` -1, wrapping round (Tab and Shift+Tab in the field). */
export function stepScope(current: SearchScope, step: 1 | -1): SearchScope {
  const index = SEARCH_SCOPES.findIndex((scope) => scope.key === current);
  return SEARCH_SCOPES[(index + step + SEARCH_SCOPES.length) % SEARCH_SCOPES.length]!.key;
}

/**
 * How well a page or an action answers what was typed, 0 for not at all: its
 * name starting with it first, then a word of it, then anywhere in it, then a
 * word of a keyword ("diary" for a daily log's "site diary"). Accents and case
 * do not count, so "shitj" finds "Shitjet".
 */
export function matchScore(query: string, label: string, keywords: readonly string[] = []): number {
  const q = normalise(query);
  if (!q) return 0;
  const name = normalise(label);
  if (name.startsWith(q)) return 3;
  if (name.split(" ").some((word) => word.startsWith(q))) return 2;
  if (name.includes(q)) return 1.5;
  if (keywords.some((keyword) => normalise(keyword).split(" ").some((word) => word.startsWith(q)))) return 1;
  return 0;
}

/**
 * The title cut where the typed text sits in it, accents and case aside, so
 * the match can be marked: `[before, match, after]`, or the title alone when
 * it does not contain it.
 */
export function markMatch(text: string, query: string): [string] | [string, string, string] {
  const q = normalise(query);
  if (!q) return [text];
  // Each character of the title, folded as `normalise` folds it, with where it started.
  let folded = "";
  const starts: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (let k = 0; k < char.length; k += 1) starts.push(index);
    folded += char;
  }
  const at = folded.indexOf(q);
  if (at < 0) return [text];
  const from = starts[at]!;
  const to = (starts[at + q.length - 1] ?? text.length - 1) + 1;
  return [text.slice(0, from), text.slice(from, to), text.slice(to)];
}
