"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { peopleEn } from "@/lib/i18n/modules/people/en";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type PeopleKey = MessageKey<"people">;

/** People's strings in English, for code that runs without a reader. */
export const englishPeople: Translate<"people"> = createTranslator("en", peopleEn);

/**
 * `t` for People's Client Components. Outside the People boundary a string
 * falls back to English rather than showing its key.
 */
export function usePeopleTranslations(): Translate<"people"> {
  const t = useTranslations("people");
  return React.useCallback<Translate<"people">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishPeople(key, values) : value;
  }, [t]);
}

/** A People string, for components that render on both the server and the client. */
export function PeopleText({ k, values }: { k: PeopleKey; values?: MessageValues }) {
  return <>{usePeopleTranslations()(k, values)}</>;
}
