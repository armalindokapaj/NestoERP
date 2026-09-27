"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { meetingsEn } from "@/lib/i18n/modules/meetings/en";
import { meetingsLabel, type MeetingsLabelGroup } from "@/lib/i18n/modules/meetings/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type MeetingsKey = MessageKey<"meetings">;

/** Meetings' strings in English, for code that runs without a reader. */
export const englishMeetings: Translate<"meetings"> = createTranslator("en", meetingsEn);

/**
 * `t` for Meetings' Client Components. Some render outside the Meetings boundary
 * (a project's Meetings tab, a daily log's print page), where a string falls
 * back to English rather than showing its key.
 */
export function useMeetingsTranslations(): Translate<"meetings"> {
  const t = useTranslations("meetings");
  return React.useCallback<Translate<"meetings">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishMeetings(key, values) : value;
  }, [t]);
}

/** A Meetings string, for components that render on both the server and the client. */
export function MeetingsText({ k, values }: { k: MeetingsKey; values?: MessageValues }) {
  return <>{useMeetingsTranslations()(k, values)}</>;
}

/** A stored Meetings value's word, keyed by value; `fallback` is the config's English label. */
export function MeetingsLabel({ group, value, fallback }: { group: MeetingsLabelGroup; value: string | number; fallback: string }) {
  return <>{meetingsLabel(useMeetingsTranslations(), group, value, fallback)}</>;
}
