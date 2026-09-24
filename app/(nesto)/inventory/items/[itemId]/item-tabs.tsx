import Link from "@/components/navigation/nav-link";

import type { ItemCapabilities } from "@/lib/modules/inventory/inventory.types";
import { cn } from "@/lib/utils/cn";

/**
 * Item record tabs (PRD #20 §305).
 *
 * A tab renders only when the reader may open what it leads to: somebody
 * without balance permission sees no Stock tab rather than one that refuses
 * them.
 */
const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "stock", label: "Stock", suffix: "/stock" },
  { key: "movements", label: "Movements", suffix: "/movements" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type ItemTabKey = (typeof TABS)[number]["key"];

export function ItemTabs({
  itemId,
  active,
  capabilities,
}: {
  itemId: string;
  active: ItemTabKey;
  capabilities: ItemCapabilities;
}) {
  const show: Record<ItemTabKey, boolean> = {
    overview: true,
    stock: capabilities.canViewStock,
    movements: capabilities.canViewMovements,
    documents: capabilities.canViewDocuments,
    activity: capabilities.canViewActivity,
  };

  const visible = TABS.filter((tab) => show[tab.key]);

  return (
    <nav aria-label="Item sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link navSource="tab"
                href={`/inventory/items/${itemId}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors",
                  isActive
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
