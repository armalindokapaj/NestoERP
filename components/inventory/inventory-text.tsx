"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { inventoryEn } from "@/lib/i18n/modules/inventory/en";
import { inventoryLabel, type InventoryLabelGroup } from "./inventory-labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type InventoryKey = MessageKey<"inventory">;
export { inventoryLabel, type InventoryLabelGroup };

/** Inventory's strings in English, for code that runs without a reader. */
export const englishInventory: Translate<"inventory"> = createTranslator("en", inventoryEn);

/**
 * `t` for Inventory's Client Components. Some render outside the Inventory boundary
 * (a stock badge on another page), so a string there falls back to English
 * rather than showing its key.
 */
export function useInventoryTranslations(): Translate<"inventory"> {
  const t = useTranslations("inventory");
  return React.useCallback<Translate<"inventory">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishInventory(key, values) : value;
  }, [t]);
}

/** A Inventory string, for components that render on both the server and the client. */
export function InventoryText({ k, values }: { k: InventoryKey; values?: MessageValues }) {
  return <>{useInventoryTranslations()(k, values)}</>;
}

/** A stored value's label, for components that render on both the server and the client. */
export function InventoryLabel({ group, value }: { group: InventoryLabelGroup; value: string }) {
  return <>{inventoryLabel(useInventoryTranslations(), group, value)}</>;
}
