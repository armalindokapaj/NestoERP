"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { contractsLabel, englishContracts, type ContractsLabelGroup } from "@/lib/i18n/modules/contracts/labels";
import type { MessageKey, MessageValues, Translate } from "@/lib/i18n/translator";

export type ContractsKey = MessageKey<"contracts">;
export { contractsLabel, englishContracts, type ContractsLabelGroup };

/**
 * `t` for Contracts' Client Components. Some render outside the Contracts
 * boundary (a unit's Legal section on a Projects page), so a string there falls
 * back to English rather than showing its key.
 */
export function useContractsTranslations(): Translate<"contracts"> {
  const t = useTranslations("contracts");
  return React.useCallback<Translate<"contracts">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishContracts(key, values) : value;
  }, [t]);
}

/** A Contracts string, for components that render on both the server and the client. */
export function ContractsText({ k, values }: { k: ContractsKey; values?: MessageValues }) {
  return <>{useContractsTranslations()(k, values)}</>;
}
