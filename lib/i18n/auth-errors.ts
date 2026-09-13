import { en } from "./messages/en";
import type { Translate } from "./translator";

type AuthErrorKey = keyof typeof en.auth.errors;

const AUTH_ERROR_KEYS = Object.keys(en.auth.errors) as AuthErrorKey[];

/**
 * The auth schemas and actions answer in English: they are shared with the
 * server, which validates before it knows who is reading. The sign-in forms
 * put what comes back into the reader's language by finding it in the English
 * dictionary — so `auth.errors` has to hold those messages word for word, which
 * tests/unit/i18n/dictionaries.test.ts checks against the schemas themselves.
 *
 * A message that is not there is shown as it came: untranslated, never lost.
 */
export function translateAuthError(t: Translate<"auth">, message: string): string {
  const key = AUTH_ERROR_KEYS.find((candidate) => en.auth.errors[candidate] === message);
  return key ? t(`errors.${key}`) : message;
}
