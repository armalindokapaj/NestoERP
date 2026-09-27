import type { inventoryEn } from "@/lib/i18n/modules/inventory/en";
import type { MessageKey, Translate } from "@/lib/i18n/translator";

/** The groups of stored values Inventory names on screen (`labels.<group>.<VALUE>`). */
export type InventoryLabelGroup = keyof typeof inventoryEn.labels;

/**
 * A stored value's label, in the reader's language — for server and client
 * alike (pure; no directive). The configuration keeps its English labels; the
 * dictionary names the same values. An unknown value falls back to `fallback`,
 * or the value itself.
 */
export function inventoryLabel(
  t: Translate<"inventory">,
  group: InventoryLabelGroup,
  value: string,
  fallback?: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"inventory">;
  const text = t(key);
  return text === key ? (fallback ?? value) : text;
}
