"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { dailyLogsEn } from "@/lib/i18n/modules/dailyLogs/en";
import { dailyLogsLabel, type DailyLogsLabelGroup } from "@/lib/i18n/modules/dailyLogs/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type DailyLogsKey = MessageKey<"dailyLogs">;

/** The module's strings in English, for code that runs without a reader. */
export const englishDailyLogs: Translate<"dailyLogs"> = createTranslator("en", dailyLogsEn);

/**
 * `t` for the module's Client Components. Some render outside its boundary
 * (a project's tab), where a string falls back to English rather than showing
 * its key.
 */
export function useDailyLogsTranslations(): Translate<"dailyLogs"> {
  const t = useTranslations("dailyLogs");
  return React.useCallback<Translate<"dailyLogs">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishDailyLogs(key, values) : value;
  }, [t]);
}

/** A string, for components that render on both the server and the client. */
export function DailyLogsText({ k, values }: { k: DailyLogsKey; values?: MessageValues }) {
  return <>{useDailyLogsTranslations()(k, values)}</>;
}

/** A stored value's word, keyed by value; `fallback` is the config's English label. */
export function DailyLogsLabel({ group, value, fallback }: { group: DailyLogsLabelGroup; value: string | number; fallback: string }) {
  return <>{dailyLogsLabel(useDailyLogsTranslations(), group, value, fallback)}</>;
}
