"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { announcementsEn } from "@/lib/i18n/modules/announcements/en";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type AnnouncementsKey = MessageKey<"announcements">;
export type AnnouncementsLabelGroup = keyof typeof announcementsEn.labels;

/** Announcements' strings in English, for code that runs without a reader. */
export const englishAnnouncements: Translate<"announcements"> = createTranslator("en", announcementsEn);

/**
 * `t` for Announcements' Client Components. Outside the Announcements boundary
 * a string falls back to English rather than showing its key.
 */
export function useAnnouncementsTranslations(): Translate<"announcements"> {
  const t = useTranslations("announcements");
  return React.useCallback<Translate<"announcements">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishAnnouncements(key, values) : value;
  }, [t]);
}

/** A stored value's word (priority, status, audience, tab); `fallback` is the English label. */
export function announcementLabel(t: Translate<"announcements">, group: AnnouncementsLabelGroup, value: string, fallback: string): string {
  const key = `labels.${group}.${value}` as AnnouncementsKey;
  const text = t(key);
  return text === key ? fallback : text;
}

/** An Announcements string, for components that render on both the server and the client. */
export function AnnouncementsText({ k, values }: { k: AnnouncementsKey; values?: MessageValues }) {
  return <>{useAnnouncementsTranslations()(k, values)}</>;
}

/** A stored value's word, for components that render on both the server and the client. */
export function AnnouncementsLabel({ group, value, fallback }: { group: AnnouncementsLabelGroup; value: string; fallback: string }) {
  return <>{announcementLabel(useAnnouncementsTranslations(), group, value, fallback)}</>;
}
