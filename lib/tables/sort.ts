import type { ColumnValueType } from "@/lib/tables/columns";

/**
 * Header sort state (AUD-08 §4, DT-04, DT-19).
 *
 * NESTO lists carry their sort in one query value, `<field>-<asc|desc>`
 * (`name-asc`, `due-desc`) or a bare named order (`recent`). A column with
 * `sortKey: "name"` is a sort control for `name-asc` / `name-desc`; with
 * `sortKey: "recent"` it is a one-way control for exactly `recent`.
 *
 * Only values the module allowlists are offered (`keys`, e.g.
 * `CLIENT_SORT_KEYS`); the server parser remains the authority and falls back
 * to its default for anything else. When `keys` is not given, both directions
 * of the stem are assumed to exist.
 */

export type AriaSort = "ascending" | "descending" | "other" | "none";

export type HeaderSortState = {
  /** What the header announces for the sort actually applied. */
  ariaSort: AriaSort;
  /** The sort value a click applies, or null when there is nothing else to switch to. */
  next: string | null;
};

function allowed(value: string, keys: readonly string[] | undefined): boolean {
  if (!keys) return /-(asc|desc)$/.test(value);
  return keys.includes(value);
}

/**
 * The applied sort: the server's parsed value when it is given (it belongs to
 * the rows on screen), else the URL value when it is allowlisted, else the
 * module default.
 */
export function appliedSort(
  parsed: string | undefined,
  urlValue: string | null | undefined,
  keys: readonly string[] | undefined,
  defaultValue: string | undefined,
): string | undefined {
  if (parsed) return parsed;
  if (urlValue && (!keys || keys.includes(urlValue))) return urlValue;
  return defaultValue;
}

export function headerSortState(
  sortKey: string,
  applied: string | undefined,
  keys?: readonly string[],
): HeaderSortState {
  const asc = `${sortKey}-asc`;
  const desc = `${sortKey}-desc`;
  const hasAsc = allowed(asc, keys);
  const hasDesc = allowed(desc, keys);
  const bare = Boolean(keys?.includes(sortKey));

  if (applied === asc) return { ariaSort: "ascending", next: hasDesc ? desc : null };
  if (applied === desc) return { ariaSort: "descending", next: hasAsc ? asc : null };
  if (bare && applied === sortKey) return { ariaSort: "other", next: null };

  // Not the applied sort: a click applies this column's first offered order —
  // the module's own listing order when `keys` is given.
  const offered = [asc, desc, sortKey].filter((value) =>
    value === sortKey ? bare : value === asc ? hasAsc : hasDesc,
  );
  if (keys) offered.sort((a, b) => keys.indexOf(a) - keys.indexOf(b));
  return { ariaSort: "none", next: offered[0] ?? null };
}

export type SortChoice = { value: string; label: string };

/** What a Sort option needs of a column: its label, its sort stem and what its cells hold. */
export type SortableColumn = { label: string; sortKey?: string; valueType?: ColumnValueType };

/**
 * The direction a Sort option names after its column. English here, so a
 * caller with no reader (a test, a script) reads as it always did; a caller
 * with one passes the same phrases in the reader's language (`common.sort`).
 */
export const SORT_WORDS = {
  earliestFirst: "earliest first",
  latestFirst: "latest first",
  lowestFirst: "lowest first",
  highestFirst: "highest first",
  aToZ: "A–Z",
  zToA: "Z–A",
  ascending: "ascending",
  descending: "descending",
};

export type SortWords = typeof SORT_WORDS;

type DirectionWords = [ascending: keyof SortWords, descending: keyof SortWords];

const DIRECTION_WORDS: Record<string, DirectionWords> = {
  date: ["earliestFirst", "latestFirst"],
  datetime: ["earliestFirst", "latestFirst"],
  money: ["lowestFirst", "highestFirst"],
  number: ["lowestFirst", "highestFirst"],
  text: ["aToZ", "zToA"],
};

/** A value type with no phrase of its own (a status column) is simply ascending or descending. */
const PLAIN_DIRECTION: DirectionWords = ["ascending", "descending"];

/**
 * The explicit Sort control's options, derived from the same columns as the
 * header sort controls (AUD-04 §5, MW-06): on a phone the table header is
 * replaced by cards, so the header's orders are offered as a labelled select
 * instead. Only allowlisted values are offered (the same rule as
 * `headerSortState`), in column order, each naming its column and direction
 * ("Due: earliest first"). A duplicate value is offered once.
 */
export function sortChoices(
  columns: readonly SortableColumn[],
  keys?: readonly string[],
  words: SortWords = SORT_WORDS,
): SortChoice[] {
  const choices: SortChoice[] = [];
  const seen = new Set<string>();
  const add = (value: string, label: string) => {
    if (seen.has(value)) return;
    seen.add(value);
    choices.push({ value, label });
  };
  for (const column of columns) {
    const key = column.sortKey;
    if (!key) continue;
    const [ascending, descending] = DIRECTION_WORDS[column.valueType ?? "text"] ?? PLAIN_DIRECTION;
    const asc = `${key}-asc`;
    const desc = `${key}-desc`;
    if (allowed(asc, keys)) add(asc, `${column.label}: ${words[ascending]}`);
    if (allowed(desc, keys)) add(desc, `${column.label}: ${words[descending]}`);
    if (keys?.includes(key)) add(key, column.label);
  }
  return choices;
}
