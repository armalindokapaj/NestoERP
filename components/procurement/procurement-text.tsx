"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { procurementEn } from "@/lib/i18n/modules/procurement/en";
import { procurementLabel, type ProcurementLabelGroup } from "@/lib/i18n/modules/procurement/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type ProcurementKey = MessageKey<"procurement">;

/** Procurement's strings in English, for code that runs without a reader. */
export const englishProcurement: Translate<"procurement"> = createTranslator("en", procurementEn);

/**
 * `t` for Procurement's Client Components. Some render outside the Procurement boundary
 * (an order embedded in another module's page), where a string falls back to English
 * rather than showing its key.
 */
export function useProcurementTranslations(): Translate<"procurement"> {
  const t = useTranslations("procurement");
  return React.useCallback<Translate<"procurement">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishProcurement(key, values) : value;
  }, [t]);
}

/** A Procurement string, for components that render on both the server and the client. */
export function ProcurementText({ k, values }: { k: ProcurementKey; values?: MessageValues }) {
  return <>{useProcurementTranslations()(k, values)}</>;
}

/** A stored Procurement value's word, keyed by value; `fallback` is the config's English label. */
export function ProcurementLabel({ group, value, fallback }: { group: ProcurementLabelGroup; value: string | number; fallback: string }) {
  return <>{procurementLabel(useProcurementTranslations(), group, value, fallback)}</>;
}

/** Every English message the Procurement server actions return, back to its key. */
const SERVER_KEYS = new Map(Object.entries(procurementEn.server).map(([key, text]) => [text, `server.${key}` as ProcurementKey]));

/**
 * A server action's message in the reader's language. The actions answer in
 * English (they cannot read the reader's locale without the server-only
 * helper); a message this module does not know passes through unchanged.
 */
export function useProcurementServerText(): (message: string | undefined | null) => string | undefined {
  const t = useProcurementTranslations();
  return React.useCallback(
    (message) => {
      if (!message) return undefined;
      const key = SERVER_KEYS.get(message);
      return key ? t(key) : message;
    },
    [t],
  );
}
