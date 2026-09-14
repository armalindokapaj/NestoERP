import { cache } from "react";
import { cookies } from "next/headers";

import { LOCALE_COOKIE, readLocale, type Locale } from "./config";
import { messages } from "./messages";
import { siteCopy, type SiteCopy } from "./site";
import { createTranslator, type Namespace, type Translate } from "./translator";

/** The reader's interface language, read once per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const cookieStore = await cookies();
  return readLocale(cookieStore.get(LOCALE_COOKIE)?.value);
});

/** `t` for a Server Component, a route's metadata or a server action. */
export async function getTranslations<N extends Namespace>(namespace: N): Promise<Translate<N>> {
  const locale = await getLocale();
  return createTranslator(locale, messages[locale][namespace]);
}

/** The public site's copy in the reader's language (see lib/i18n/site/en.ts). */
export async function getSiteCopy(): Promise<SiteCopy> {
  return siteCopy[await getLocale()];
}
