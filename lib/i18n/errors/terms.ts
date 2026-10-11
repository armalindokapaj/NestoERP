import type { TermLookup } from "@/lib/i18n/catalogue";
import { translateSentences } from "@/lib/i18n/catalogue";
import { messages } from "@/lib/i18n/messages";
import { moduleMessages } from "@/lib/i18n/modules";
import { SLOT_KINDS, slotText } from "@/lib/i18n/system/slots";

import { errorCatalogue } from "./catalogue";

/**
 * The English words that arrive inside a refusal, in Albanian.
 *
 * A row's `slots` says what a hole carries; this answers for each kind. A status or an enumeration is the
 * word the module's pages show (lib/i18n/system/slots.ts); a field's label is the label the forms show,
 * found through the English the code wrote; a message nested in another is a sentence of its own. A word
 * nobody knows is `undefined`, and the sentence keeps it as the code wrote it.
 */

const lowerFirst = (text: string) => (/^\p{Lu}(?=\p{Ll}|\s|$)/u.test(text) ? text[0].toLowerCase() + text.slice(1) : text);
const isLowerCase = (text: string) => text === text.toLowerCase() && /\p{Ll}/u.test(text);

/** zod names the kind of a value in these words (`Invalid input: expected string, received undefined`). */
const VALUE_TYPES: Readonly<Record<string, string>> = {
  string: "tekst",
  number: "numër",
  int: "numër i plotë",
  bigint: "numër i madh",
  boolean: "vlerë po/jo",
  object: "objekt",
  array: "listë",
  date: "datë",
  map: "hartë",
  set: "bashkësi",
  file: "skedar",
  undefined: "vlerë e munguar",
  null: "vlerë boshe",
  nan: "NaN",
  symbol: "simbol",
  function: "funksion",
};

/** Every short English label of the interface, lower-cased for lookup, with the Albanian the interface uses for it most often. */
let labels: Map<string, string> | undefined;

function labelIndex(): Map<string, string> {
  if (labels) return labels;
  const seen = new Map<string, Map<string, number>>();
  const walk = (en: unknown, sq: unknown) => {
    if (typeof en === "string") {
      if (typeof sq !== "string" || !sq.trim() || sq === en || en.length > 40 || /[{}.]/.test(en)) return;
      const key = en.toLowerCase();
      const counts = seen.get(key) ?? new Map<string, number>();
      counts.set(sq, (counts.get(sq) ?? 0) + 1);
      seen.set(key, counts);
      return;
    }
    if (en && typeof en === "object") for (const key of Object.keys(en)) walk((en as Record<string, unknown>)[key], (sq as Record<string, unknown> | undefined)?.[key]);
  };
  walk(messages.en, messages.sq);
  walk(moduleMessages.en, moduleMessages.sq);
  labels = new Map();
  for (const [key, counts] of seen) {
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    labels.set(key, best[0][0]);
  }
  return labels;
}

/** A label as the forms show it, in the case the sentence wrote it in. */
function labelText(english: string): string | undefined {
  const found = labelIndex().get(english.toLowerCase());
  if (found === undefined) return undefined;
  return isLowerCase(english) ? lowerFirst(found) : found;
}

const statuses = new Map<string, string | null>();

/** A status or another enumerated word, whichever of the kinds the code writes it as. */
function statusText(english: string): string | undefined {
  const known = statuses.get(english);
  if (known !== undefined) return known ?? undefined;
  let found: string | undefined;
  for (const kind of SLOT_KINDS) {
    found = slotText(kind, english);
    if (found !== undefined) break;
  }
  found ??= labelText(english);
  statuses.set(english, found ?? null);
  return found;
}

/** A list the code joined with commas or arrows: each part on its own, kept as written where nobody knows it. */
function listText(english: string): string | undefined {
  const separator = english.includes(" → ") ? " → " : ", ";
  const parts = english.split(separator);
  const translated = parts.map((part) => labelText(part) ?? statusText(part));
  return translated.some((part) => part !== undefined) ? parts.map((part, index) => translated[index] ?? part).join(separator) : undefined;
}

export const errorTerm: TermLookup = (kind, english) => {
  switch (kind) {
    case "message":
      return translateSentences(errorCatalogue(), english, errorTerm);
    case "list":
      return listText(english);
    case "type":
      return VALUE_TYPES[english];
    case "label": {
      // "Enter a unit price." writes its article beside the label: the label is what is looked up.
      const bare = english.replace(/^(?:a|an) (?=\S)/i, "");
      return labelText(bare) ?? statusText(bare);
    }
    default:
      return statusText(english);
  }
};
