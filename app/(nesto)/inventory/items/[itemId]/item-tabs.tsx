import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";

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
  active,
  capabilities,
}: {
  itemId: string;
  active: ItemTabKey;
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

  const visible = TABS.filter((tab) => show[tab.key]);

  return (
    <ContextTabsFrame label={t("tabs.itemSections")}>
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link key={tab.key} navSource="tab"
                href={`/inventory/items/${itemId}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={contextTabClass(isActive)}
              >
                {t(tab.label)}
              </Link>
          );
        })}
      </ContextTabsFrame>
  );
}
