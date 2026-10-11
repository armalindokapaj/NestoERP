import { cookies } from "next/headers";

import { DEFAULT_LOCALE, LOCALE_COOKIE, readLocale, type Locale } from "@/lib/i18n/config";
import type { FieldErrors } from "@/lib/forms/errors";

/**
 * The reader's language at a server edge, and a refusal worded in it.
 *
 * Server only. The catalogue and the dictionaries behind it are a few hundred kilobytes that nearly
 * every route would otherwise carry, and an English reader never needs them: they are imported when a
 * request turns out to be Albanian (`requestLocale`), and the sync helpers below pass English through
 * until then. A job, a script or a test has no request, nobody to translate for, and the answer is English.
 */

type Wording = typeof import("./index");

let wording: Wording | undefined;

/**
 * The reader's language, read once as a request starts (the cookie `getLocale` reads, without its
 * throw outside a request). For an Albanian reader it also brings the catalogue in, so that `apiError`,
 * which is synchronous, can use it.
 */
export async function requestLocale(): Promise<Locale> {
  let locale: Locale = DEFAULT_LOCALE;
  try {
    locale = readLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch (error) {
    // Next's own signals — a redirect, a bail-out to dynamic rendering — are not "no request" and are passed on.
    if (typeof (error as { digest?: unknown } | null)?.digest === "string") throw error;
  }
  if (locale !== DEFAULT_LOCALE) wording ??= await import("./index");
  return locale;
}

export function shownMessage(message: string, locale: Locale): string {
  return wording ? wording.localizeMessage(message, locale) : message;
}

export function shownFieldErrors<T extends FieldErrors | undefined>(fieldErrors: T, locale: Locale): T {
  return wording ? wording.localizeFieldErrors(fieldErrors, locale) : fieldErrors;
}

export function shownDetails(details: unknown, locale: Locale): unknown {
  return wording ? wording.localizeDetails(details, locale) : details;
}

/** What an action answers when it fails; `error` is the form-level sentence, `message` is the settings page's name for it. */
type Failing = { ok: false; error?: string; message?: string; fieldErrors?: FieldErrors };

/** An action's failure with its sentences in the reader's language. The code, category and reference stay as they are. */
export async function localizeActionFailure<T extends Failing>(failure: T): Promise<T> {
  const locale = await requestLocale();
  if (locale === DEFAULT_LOCALE) return failure;
  const shown: Failing = { ...failure };
  if (typeof failure.error === "string") shown.error = shownMessage(failure.error, locale);
  if (typeof failure.message === "string") shown.message = shownMessage(failure.message, locale);
  if (failure.fieldErrors) shown.fieldErrors = shownFieldErrors(failure.fieldErrors, locale);
  return shown as T;
}
