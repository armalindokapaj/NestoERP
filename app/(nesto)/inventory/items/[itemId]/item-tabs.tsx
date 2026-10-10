import { ContextTabs } from "@/components/navigation/context-tabs";

import type { ItemCapabilities } from "@/lib/modules/inventory/inventory.types";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Item record tabs (PRD #20 §305).
 *
 * A tab renders only when the reader may open what it leads to: somebody
 * without balance permission sees no Stock tab rather than one that refuses
 * them.
 */
const TABS = [
  { key: "overview", label: "tabs.overview", suffix: "" },
  { key: "stock", label: "meta.stock", suffix: "/stock" },
  { key: "movements", label: "meta.movements", suffix: "/movements" },
  { key: "documents", label: "meta.documents", suffix: "/documents" },
  { key: "activity", label: "meta.activity", suffix: "/activity" },
] as const;

export type ItemTabKey = (typeof TABS)[number]["key"];

export async function ItemTabs({
  itemId,
  capabilities,
}: {
  itemId: string;
  capabilities: ItemCapabilities;
}) {
  const t = await getTranslations("inventory");
  const show: Record<ItemTabKey, boolean> = {
    overview: true,
    stock: capabilities.canViewStock,
    movements: capabilities.canViewMovements,
    documents: capabilities.canViewDocuments,
    activity: capabilities.canViewActivity,
  };

  const tabs = TABS.filter((tab) => show[tab.key]).map((tab) => ({
    key: tab.key,
    label: t(tab.label),
    href: `/inventory/items/${itemId}${tab.suffix}`,
  }));

  // The active tab follows the URL, so the tabs can sit in the layout and stay put.
  return <ContextTabs label={t("tabs.itemSections")} tabs={tabs} rootKey="overview" />;
}
