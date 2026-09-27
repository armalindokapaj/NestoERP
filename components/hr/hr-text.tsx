"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { hrEn } from "@/lib/i18n/modules/hr/en";
import { hrLabel, type HrLabelGroup } from "./hr-labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type HrKey = MessageKey<"hr">;
export { hrLabel, type HrLabelGroup };

/** HR's strings in English, for code that runs without a reader. */
export const englishHr: Translate<"hr"> = createTranslator("en", hrEn);

/**
 * `t` for HR's Client Components. Some render outside the HR boundary
 * (a stock badge on another page), so a string there falls back to English
 * rather than showing its key.
 */
export function useHrTranslations(): Translate<"hr"> {
  const t = useTranslations("hr");
  return React.useCallback<Translate<"hr">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishHr(key, values) : value;
  }, [t]);
}

/** An HR string, for components that render on both the server and the client. */
export function HrText({ k, values }: { k: HrKey; values?: MessageValues }) {
  return <>{useHrTranslations()(k, values)}</>;
}

/** A stored value's label, for components that render on both the server and the client. */
export function HrLabel({ group, value }: { group: HrLabelGroup; value: string }) {
  return <>{hrLabel(useHrTranslations(), group, value)}</>;
}

/** Every English message the HR server actions return, back to its key. */
const SERVER_KEYS = new Map(Object.entries(hrEn.server).map(([key, text]) => [text, `server.${key}` as HrKey]));

/**
 * A server action's message in the reader's language. The actions answer in
 * English (they cannot read the reader's locale without the server-only
 * helper); a message this module does not know passes through unchanged.
 */
export function useHrServerText(): (message: string | undefined | null) => string | undefined {
  const t = useHrTranslations();
  return React.useCallback(
    (message) => {
      if (!message) return undefined;
      const key = SERVER_KEYS.get(message);
      return key ? t(key) : message;
    },
    [t],
  );
}

/** A form action whose refusal reads in the reader's language (the action itself answers in English). */
export function useHrFormAction<R extends { ok: boolean; error?: string }>(
  action: (formData: FormData) => Promise<R>,
): (formData: FormData) => Promise<R> {
  const serverText = useHrServerText();
  return React.useCallback(
    async (formData: FormData) => {
      const result = await action(formData);
      return !result.ok && result.error ? { ...result, error: serverText(result.error) ?? result.error } : result;
    },
    [action, serverText],
  );
}
