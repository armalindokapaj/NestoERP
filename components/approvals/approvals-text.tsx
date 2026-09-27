"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { approvalsEn } from "@/lib/i18n/modules/approvals/en";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type ApprovalsKey = MessageKey<"approvals">;

/** The Approvals Center's strings in English, for code that runs without a reader. */
export const englishApprovals: Translate<"approvals"> = createTranslator("en", approvalsEn);

/**
 * `t` for the Approvals Center's Client Components. Outside the Approvals
 * boundary (a unit test's render) a string falls back to English rather than
 * showing its key.
 */
export function useApprovalsTranslations(): Translate<"approvals"> {
  const t = useTranslations("approvals");
  return React.useCallback<Translate<"approvals">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishApprovals(key, values) : value;
  }, [t]);
}

/** An Approvals string, for components that render on both the server and the client. */
export function ApprovalsText({ k, values }: { k: ApprovalsKey; values?: MessageValues }) {
  return <>{useApprovalsTranslations()(k, values)}</>;
}

/** The providers' English module and source names, and the English messages the client knows, back to their keys. */
const ENGLISH_KEYS = new Map<string, ApprovalsKey>([
  ...Object.entries(approvalsEn.providers).map(([key, text]) => [text, `providers.${key}` as ApprovalsKey] as const),
  ...Object.entries(approvalsEn.sources).map(([key, text]) => [text, `sources.${key}` as ApprovalsKey] as const),
  ...Object.entries(approvalsEn.errors).map(([key, text]) => [text, `errors.${key}` as ApprovalsKey] as const),
]);

/**
 * A provider's English label (a module or source name) or a known English
 * message in the reader's language; anything else passes through unchanged.
 */
export function approvalsWord(t: Translate<"approvals">, english: string): string {
  const key = ENGLISH_KEYS.get(english);
  return key ? t(key) : english;
}

/** `approvalsWord` bound to the reader. */
export function useApprovalsWord(): (english: string) => string {
  const t = useApprovalsTranslations();
  return React.useCallback((english: string) => approvalsWord(t, english), [t]);
}
