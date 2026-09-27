"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { timesheetsEn } from "@/lib/i18n/modules/timesheets/en";
import { timesheetsLabel, type TimesheetsLabelGroup } from "@/lib/i18n/modules/timesheets/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type TimesheetsKey = MessageKey<"timesheets">;

/** The module's strings in English, for code that runs without a reader. */
export const englishTimesheets: Translate<"timesheets"> = createTranslator("en", timesheetsEn);

/**
 * `t` for the module's Client Components. Some render outside its boundary
 * (a project's tab), where a string falls back to English rather than showing
 * its key.
 */
export function useTimesheetsTranslations(): Translate<"timesheets"> {
  const t = useTranslations("timesheets");
  return React.useCallback<Translate<"timesheets">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishTimesheets(key, values) : value;
  }, [t]);
}

/** A string, for components that render on both the server and the client. */
export function TimesheetsText({ k, values }: { k: TimesheetsKey; values?: MessageValues }) {
  return <>{useTimesheetsTranslations()(k, values)}</>;
}

/** A stored value's word, keyed by value; `fallback` is the config's English label. */
export function TimesheetsLabel({ group, value, fallback }: { group: TimesheetsLabelGroup; value: string | number; fallback: string }) {
  return <>{timesheetsLabel(useTimesheetsTranslations(), group, value, fallback)}</>;
}
