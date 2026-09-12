import { notFound } from "next/navigation";

import { ItemActions } from "@/components/inventory/item-actions";
import { RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { StockLevelBadge } from "@/components/inventory/stock-level-badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as items from "@/lib/modules/inventory/items/item.service";
import { itemCategoryLabels } from "@/lib/modules/inventory/inventory.status";
import type { ItemDetailDTO } from "@/lib/modules/inventory/inventory.types";
import { formatQuantity } from "@/components/inventory/inventory-format";
import { ItemTabs, type ItemTabKey } from "./item-tabs";

/**
 * The furniture every item tab shares (PRD #20 §305, §306).
 *
 * Loaded once per page rather than duplicated across five routes, and it is
 * also where a reader who cannot open the tab they asked for gets a 404 rather
 * than a 403 — the record's existence is itself information (PRD #7 §60).
 */
export async function loadItemPage(
  itemId: string,
  tab: ItemTabKey,
): Promise<{ context: UserContext; item: ItemDetailDTO }> {
  const context = await requireModule("inventory");

  let item: ItemDetailDTO;
  try {
    item = await items.getItem(context, itemId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const allowed: Record<ItemTabKey, boolean> = {
    overview: true,
    stock: item.capabilities.canViewStock,
    movements: item.capabilities.canViewMovements,
    documents: item.capabilities.canViewDocuments,
    activity: item.capabilities.canViewActivity,
  };
  if (!allowed[tab]) notFound();

  return { context, item };
}

export function ItemPageShell({
  item,
  tab,
  children,
}: {
  item: ItemDetailDTO;
  tab: ItemTabKey;
  children: React.ReactNode;
}) {
  const totals = item.byLocation.reduce(
    (running, row) => ({
      onHand: running.onHand + Number.parseFloat(row.onHand),
      reserved: running.reserved + Number.parseFloat(row.reserved),
      available: running.available + Number.parseFloat(row.available),
    }),
    { onHand: 0, reserved: 0, available: 0 },
  );

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Items", href: "/inventory/items" },
          { label: item.name },
        ]}
        title={item.name}
        subtitle={item.sku}
        status={item.status}
        badges={
          <>
            <Badge tone="neutral">{itemCategoryLabels[item.category]}</Badge>
            {item.capabilities.canViewStock ? <StockLevelBadge level={item.level} /> : null}
          </>
        }
        meta={
          item.capabilities.canViewStock
            ? [
                {
                  label: "On hand",
                  value: `${formatQuantity(totals.onHand.toFixed(4))} ${item.baseUnit}`,
                },
                {
                  label: "Reserved",
                  value: `${formatQuantity(totals.reserved.toFixed(4))} ${item.baseUnit}`,
                },
                {
                  label: "Available",
                  value: `${formatQuantity(totals.available.toFixed(4))} ${item.baseUnit}`,
                },
              ]
            : [{ label: "Unit", value: item.baseUnit }]
        }
        actions={<ItemActions item={item} />}
      />

      <ItemTabs itemId={item.id} active={tab} capabilities={item.capabilities} />

      {item.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This item is archived. Its ledger history is intact, but it cannot be named on new
          stock documents until it is restored.
        </p>
      ) : null}

      {children}
    </div>
  );
}
