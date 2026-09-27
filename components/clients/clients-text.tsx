"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { clientsEn } from "@/lib/i18n/modules/clients/en";
import { clientsLabel, type ClientsLabelGroup } from "@/lib/i18n/modules/clients/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type ClientsKey = MessageKey<"clients">;

/** Clients' strings in English, for code that runs without a reader. */
export const englishClients: Translate<"clients"> = createTranslator("en", clientsEn);

/** `t` for Clients' Client Components; outside the Clients boundary a string falls back to English. */
export function useClientsTranslations(): Translate<"clients"> {
  const t = useTranslations("clients");
  return React.useCallback<Translate<"clients">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishClients(key, values) : value;
  }, [t]);
}

/** A Clients string, for components that render on both the server and the client. */
export function ClientsText({ k, values }: { k: ClientsKey; values?: MessageValues }) {
  return <>{useClientsTranslations()(k, values)}</>;
}

/** A stored Clients value's word, keyed by value; `fallback` is the config's English label. */
export function ClientsLabel({ group, value, fallback }: { group: ClientsLabelGroup; value: string; fallback: string }) {
  return <>{clientsLabel(useClientsTranslations(), group, value, fallback)}</>;
}

/** Every English message the client actions return, back to its key. */
const SERVER_KEYS = new Map(Object.entries(clientsEn.server).map(([key, text]) => [text, `server.${key}` as ClientsKey]));

/** A client action's message in the reader's language; one this module does not know passes through. */
export function useClientsServerText(): (message: string | undefined | null) => string | undefined {
  const t = useClientsTranslations();
  return React.useCallback((message) => {
    if (!message) return undefined;
    const key = SERVER_KEYS.get(message);
    return key ? t(key) : message;
  }, [t]);
}
