"use client";

import * as React from "react";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { calendarEn } from "@/lib/i18n/modules/calendar/en";
import { calendarLabel, type CalendarLabelGroup } from "@/lib/i18n/modules/calendar/labels";
import { createTranslator, type MessageKey, type Translate } from "@/lib/i18n/translator";
import { intlLocale, type DayWords } from "./calendar-model";

export type CalendarKey = MessageKey<"calendar">;
export { calendarLabel, type CalendarLabelGroup };

/** Calendar's strings in English, for code that runs without a reader. */
export const englishCalendar: Translate<"calendar"> = createTranslator("en", calendarEn);

/**
 * `t` for Calendar's Client Components. Some render outside the Calendar
 * boundary (a project's Calendar tab), where a string falls back to English
 * rather than showing its key.
 */
export function useCalendarTranslations(): Translate<"calendar"> {
  const t = useTranslations("calendar");
  return React.useCallback<Translate<"calendar">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishCalendar(key, values) : value;
  }, [t]);
}

/** The reader's words for days and the locale dates are written in (English keeps en-GB). */
export function useDayWords(): DayWords {
  const t = useCalendarTranslations();
  const locale = useLocale();
  return React.useMemo(
    () => ({ locale: intlLocale(locale), today: t("days.today"), tomorrow: t("days.tomorrow"), yesterday: t("days.yesterday") }),
    [t, locale],
  );
}
