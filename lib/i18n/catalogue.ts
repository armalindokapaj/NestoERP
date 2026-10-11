/**
 * Translation of finished English text, by catalogue.
 *
 * Most of the interface is translated by key, at the place it is drawn. Some
 * text cannot be: a refusal thrown deep in a service, a notification stored
 * weeks ago, an activity line written when the change happened. That text is
 * English by the time anybody could translate it, and it stays English where
 * it is written and stored — logs, audit rows, tests and other readers depend
 * on it. It is put into the reader's language at the last moment, by finding
 * the English sentence in a catalogue.
 *
 * A catalogue is keyed by the English text itself, exactly as it is written:
 *
 *   "That record does not exist.": "Ai regjistrim nuk ekziston."
 *
 * A key with `{holes}` is a pattern, for a sentence with values in it. The
 * holes are whatever the sentence's writer named them (`{0}`, `{title}`); the
 * Albanian side places the same holes where its grammar wants them:
 *
 *   "Amendment {0} already exists on this contract.": "Amendamenti {0} ekziston tashmë në këtë kontratë."
 *
 * A hole that carries an English word rather than data — a status, a field's
 * label — names the kind of word, and the caller's `terms` lookup translates
 * it. A kind ending in `!` must translate, or the pattern does not match: that
 * is how a pattern with almost no fixed text ("Enter {0}.") is kept from
 * swallowing sentences it was never written for.
 *
 *   "Enter {0}.": { sq: "Shkruani {0}.", slots: { 0: "label!" } }
 *
 * Where the words of such a kind are a known set, the hole is matched as one of
 * them and nothing else. That is what lets two holes stand side by side: in
 * "marked {legalName} {status}" the name ends where a status begins, which no
 * amount of guessing at the space between them would find.
 *
 * Nothing here knows about requests, cookies or React: the module is pure, so
 * the server, the browser and the tests share it. A text with no entry is
 * answered with `undefined`, and the caller shows the English it already has —
 * untranslated, never lost.
 */

export type CatalogueRow = string | { readonly sq: string; readonly slots?: Readonly<Record<string, string>> };

/** English text → its Albanian. A key containing `{hole}` is a pattern. */
export type Catalogue = Readonly<Record<string, CatalogueRow>>;

/** A word carried in a hole (`kind` is what the row called it), in the reader's language; `undefined` when unknown. */
export type TermLookup = (kind: string, english: string) => string | undefined;

type CompiledPattern = {
  key: string;
  regex: RegExp;
  holes: readonly string[];
  sq: string;
  slots: Readonly<Record<string, string>>;
  /** Letters of fixed text: what the ordering and the catch-all guard go by. */
  literal: number;
  /** All of the fixed text, punctuation and spaces too: what tells "{a} · {b} documents" from "{b} documents". */
  fixed: number;
  /** The fixed text before the first hole, for a cheap first test. */
  prefix: string;
};

export type CompiledCatalogue = {
  exact: ReadonlyMap<string, string>;
  patterns: readonly CompiledPattern[];
};

const HOLE = /\{(\w+)\}/g;

/**
 * A message that is a code, not a sentence (`RATE_LIMITED`, `COMMENT_TOO_LONG`).
 * The browser looks such messages up or compares them; they are never translated.
 */
export const MACHINE_CODE = /^[A-Z][A-Z0-9]*(?:[_.:-][A-Z0-9]+)*$/;

/** Longer than any sentence the product writes; matching is skipped rather than risked. */
const LONGEST_TEXT = 800;

/** What a row holds until somebody has translated it. Such a row is no entry at all: the English is shown. */
export const UNTRANSLATED = "__TODO__";

/**
 * A pattern with fewer letters of fixed text than this would match almost
 * anything, among sentences of every kind. A catalogue that is only ever asked
 * about one kind of text (one notification's own titles, activity lines) may
 * set its own, lower floor.
 */
export const LEAST_FIXED_LETTERS = 8;

export type CompileOptions = {
  leastFixedLetters?: number;
  /**
   * The English words a kind of hole can carry, where they are a known set
   * (the statuses of a contractor, the verbs a sentence is finished with). A
   * hole of a required kind (`kind!`) is then matched as exactly one of them;
   * a kind this does not know keeps the open match and is checked when the
   * sentence is written out.
   */
  words?: (kind: string) => readonly string[] | undefined;
};

/** The names of the holes in a text, in order of first appearance. */
export function holesOf(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(HOLE)) if (!names.includes(match[1])) names.push(match[1]);
  return names;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One of a set of words, the longest first so that "approved with comments" is not cut short at "approved". */
function oneOf(words: readonly string[]): string {
  return `(${[...words].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})`;
}

function compilePattern(key: string, row: CatalogueRow, words: CompileOptions["words"]): CompiledPattern {
  const holes: string[] = [];
  const slots = typeof row === "string" ? {} : (row.slots ?? {});
  let literal = 0;
  let fixed = 0;
  let prefix: string | null = null;
  const source = key
    .split(/(\{\w+\})/)
    .map((part) => {
      const hole = /^\{(\w+)\}$/.exec(part);
      if (!hole) {
        literal += part.replace(/[^\p{L}]/gu, "").length;
        fixed += part.length;
        if (prefix === null) prefix = part;
        return escapeRegExp(part);
      }
      if (prefix === null) prefix = "";
      const index = holes.indexOf(hole[1]);
      // The same hole twice must hold the same text twice.
      if (index >= 0) return `\\${index + 1}`;
      holes.push(hole[1]);
      const declared = slots[hole[1]];
      const known = declared?.endsWith("!") ? words?.(declared.slice(0, -1)) : undefined;
      return known?.length ? oneOf(known) : "(.+?)";
    })
    .join("");
  return {
    key,
    regex: new RegExp(`^${source}$`, "s"),
    holes,
    sq: typeof row === "string" ? row : row.sq,
    slots,
    literal,
    fixed,
    prefix: prefix ?? "",
  };
}

/** Whether one of a pattern's holes must be a known word for it to match. */
function hasRequiredTerm(pattern: CompiledPattern): boolean {
  return Object.values(pattern.slots).some((kind) => kind.endsWith("!"));
}

/**
 * Reads catalogues into the form `translateText` matches against. Later
 * catalogues win over earlier ones for the same English text. A pattern with
 * too little fixed text and no required word is left out: it is a catch-all.
 */
export function compileCatalogue(catalogues: Catalogue | readonly Catalogue[], options: CompileOptions = {}): CompiledCatalogue {
  const floor = options.leastFixedLetters ?? LEAST_FIXED_LETTERS;
  const exact = new Map<string, string>();
  const patterns = new Map<string, CompiledPattern>();
  for (const catalogue of Array.isArray(catalogues) ? (catalogues as readonly Catalogue[]) : [catalogues as Catalogue]) {
    for (const [key, row] of Object.entries(catalogue)) {
      const albanian = typeof row === "string" ? row : row.sq;
      if (!albanian || albanian.includes(UNTRANSLATED)) continue;
      if (key.includes("{") && holesOf(key).length > 0) {
        const pattern = compilePattern(key, row, options.words);
        if (pattern.literal >= floor || hasRequiredTerm(pattern)) patterns.set(key, pattern);
      } else {
        exact.set(key, typeof row === "string" ? row : row.sq);
      }
    }
  }
  // Most fixed text first, so the most specific sentence is tried before a looser one that would also fit.
  const ordered = [...patterns.values()].sort((a, b) => b.literal - a.literal || b.fixed - a.fixed || a.holes.length - b.holes.length || b.key.length - a.key.length);
  return { exact, patterns: ordered };
}

function render(pattern: CompiledPattern, match: RegExpExecArray, terms: TermLookup | undefined): string | undefined {
  const values = new Map<string, string>();
  for (const [index, name] of pattern.holes.entries()) {
    const captured = match[index + 1];
    const declared = pattern.slots[name];
    if (!declared) {
      values.set(name, captured);
      continue;
    }
    const required = declared.endsWith("!");
    const kind = required ? declared.slice(0, -1) : declared;
    const word = terms?.(kind, captured);
    if (word === undefined && required) return undefined;
    values.set(name, word ?? captured);
  }
  return pattern.sq.replace(HOLE, (whole, name: string) => values.get(name) ?? whole);
}

/**
 * The Albanian for one English text: its exact entry, or the first pattern it
 * fits. `undefined` when the catalogue has neither — and always for a machine
 * code, an empty text or an implausibly long one.
 */
export function translateText(catalogue: CompiledCatalogue, text: string, terms?: TermLookup): string | undefined {
  if (!text || text.length > LONGEST_TEXT || MACHINE_CODE.test(text)) return undefined;
  const exact = catalogue.exact.get(text);
  if (exact !== undefined) return exact;
  for (const pattern of catalogue.patterns) {
    if (pattern.prefix && !text.startsWith(pattern.prefix)) continue;
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const rendered = render(pattern, match, terms);
    if (rendered !== undefined) return rendered;
  }
  return undefined;
}

/**
 * As `translateText`, and for a text of several sentences that has no entry of
 * its own, sentence by sentence — but only when every sentence resolves: a
 * message is shown whole in one language, never half translated.
 */
export function translateSentences(catalogue: CompiledCatalogue, text: string, terms?: TermLookup): string | undefined {
  const whole = translateText(catalogue, text, terms);
  if (whole !== undefined) return whole;
  if (!text || text.length > LONGEST_TEXT || MACHINE_CODE.test(text)) return undefined;
  const sentences = text.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}“"'(])/u);
  if (sentences.length < 2) return undefined;
  const translated: string[] = [];
  for (const sentence of sentences) {
    const part = translateText(catalogue, sentence, terms);
    if (part === undefined) return undefined;
    translated.push(part);
  }
  return translated.join(" ");
}

/** A text to try a pattern with: each hole filled with a plain value. For guards that check a pattern finds itself. */
export function samplePattern(key: string, fill: (hole: string, index: number) => string = (_hole, index) => ["Alpha", "Bravo 7", "Charlie", "Delta", "Echo"][index % 5]): string {
  const names = holesOf(key);
  return key.replace(HOLE, (_whole, name: string) => fill(name, names.indexOf(name)));
}
