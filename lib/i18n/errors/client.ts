import { compileCatalogue, translateText, type CompiledCatalogue } from "@/lib/i18n/catalogue";
import { isLocale, SOURCE_LOCALE } from "@/lib/i18n/config";

import { rows } from "./catalogue/sq/client";

/**
 * The text the browser itself raises — the request helper's copy, a save outcome's, a form parser's
 * message — in the reader's language. Safe on both sides, no React and nothing of the server's.
 *
 * The language is the document's: `<html lang>` is the locale the server rendered in (app/layout.tsx).
 * With no document (a server render, a test) the answer is the English passed in, which is also what an
 * English reader gets. Only the browser's own sentences are in this table; a refusal the server wrote
 * arrives in the reader's language already.
 */

let compiled: CompiledCatalogue | undefined;

/** The table asks only about its own few sentences, so even "Enter a {0}." is safe to match. */
function table(): CompiledCatalogue {
  compiled ??= compileCatalogue(rows, { leastFixedLetters: 1 });
  return compiled;
}

export function localizeClient(message: string): string {
  if (typeof document === "undefined") return message;
  const lang = document.documentElement.lang;
  if (!isLocale(lang) || lang === SOURCE_LOCALE) return message;
  return translateText(table(), message) ?? message;
}
