import { translateSentences } from "@/lib/i18n/catalogue";
import { SOURCE_LOCALE, type Locale } from "@/lib/i18n/config";
import type { FieldErrors } from "@/lib/forms/errors";

import { errorCatalogue } from "./catalogue";
import { errorTerm } from "./terms";

/**
 * A refusal's English in the reader's language, at the two edges that leave the server: the route
 * envelope (lib/api/respond.ts) and the server action's answer (lib/actions/result.ts).
 *
 * Services keep throwing English. Logs, the audit trail, metrics and every piece of code that reads
 * `error.message` see that English; it is put into the reader's language only as the answer is written.
 * A reader of the source language gets back exactly what was passed in — each function's first line —
 * and a sentence the catalogue does not hold is answered as it is, never half translated. A machine
 * code (`RATE_LIMITED`) is never touched: the browser compares and looks it up.
 *
 * Server only; the browser's own few sentences are lib/i18n/errors/client.ts.
 */

export function localizeMessage(message: string, locale: Locale): string {
  if (locale === SOURCE_LOCALE) return message;
  return translateSentences(errorCatalogue(), message, errorTerm) ?? message;
}

/** Each field's messages, one by one: a field with a sentence nobody translated keeps that sentence in English. */
export function localizeFieldErrors<T extends FieldErrors | undefined>(fieldErrors: T, locale: Locale): T {
  if (locale === SOURCE_LOCALE || !fieldErrors) return fieldErrors;
  const result: FieldErrors = {};
  for (const [field, messages] of Object.entries(fieldErrors)) result[field] = messages.map((message) => localizeMessage(message, locale));
  return result as T;
}

/**
 * A refusal's `details`: the lists of sentences per field that `detailsFieldErrors` reads as messages
 * (every item has a space in it) are translated; a business code, a field name or any other data is not.
 */
export function localizeDetails(details: unknown, locale: Locale): unknown {
  if (locale === SOURCE_LOCALE || !details || typeof details !== "object" || Array.isArray(details)) return details;
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (key !== "code" && key !== "field" && Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && /\s/.test(item.trim()))) {
      const shown = (value as string[]).map((item) => localizeMessage(item, locale));
      changed ||= shown.some((item, index) => item !== value[index]);
      result[key] = shown;
    } else {
      result[key] = value;
    }
  }
  return changed ? result : details;
}
