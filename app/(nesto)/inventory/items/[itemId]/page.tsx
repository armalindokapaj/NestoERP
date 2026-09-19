import type { Metadata } from "next";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { StockTable } from "@/components/inventory/stock-table";
import { formatQuantity } from "@/components/inventory/inventory-format";
import { requireModule } from "@/lib/context/current-user";
import * as itemService from "@/lib/modules/inventory/items/item.service";
import { itemCategoryLabels } from "@/lib/modules/inventory/inventory.status";
import { formatDateTime } from "@/lib/utils/format";
import { ItemPageShell, loadItemPage } from "./item-shell";

type Params = { params: Promise<{ itemId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { itemId } = await params;
  try {
    const context = await requireModule("inventory");
    const item = await itemService.getItem(context, itemId);
    return { title: item.name };
  } catch {
    return { title: "Inventory item" };
  }
}

/** Item overview (PRD #20 §306). */
export default async function ItemPage({ params }: Params) {
  const { itemId } = await params;
  const { item } = await loadItemPage(itemId, "overview");

  return (
    <ItemPageShell item={item} tab="overview">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Details</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "SKU", value: item.sku },
                { label: "Category", value: itemCategoryLabels[item.category] },
                { label: "Base unit", value: item.baseUnit },
                {
                  label: "Minimum stock",
                  value:
                    item.minimumStock === null
                      ? "Not set"
                      : `${formatQuantity(item.minimumStock)} ${item.baseUnit}`,
                },
                {
                  label: "Reorder point",
                  value:
                    item.reorderPoint === null
                      ? "Not set"
                      : `${formatQuantity(item.reorderPoint)} ${item.baseUnit}`,
                },
                {
                  label: "Default warehouse",
                  value: item.defaultWarehouse
                    ? `${item.defaultWarehouse.code} — ${item.defaultWarehouse.name}`
                    : "Not set",
                },
                {
                  label: "Default location",
                  value: item.defaultLocation ? item.defaultLocation.code : "Not set",
                },
              ]}
            />

            {item.description ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">Description</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {item.description}
                </p>
              </div>
            ) : null}
          </section>

          {item.capabilities.canViewStock ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Where it is</h2>
              {item.byLocation.length === 0 ? (
                <p className="nesto-card p-5 text-table text-fg-subtle">
                  None of this item is recorded anywhere you can see.
                </p>
              ) : (
                <StockTable
                  rows={item.byLocation}
                  show="by-item"
                  caption={`${item.name} by location`}
                />
              )}
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <dl className="mt-4 space-y-3">
              <Meta label="Added by" value={item.createdBy ? <PersonLink memberId={item.createdBy.memberId} name={item.createdBy.fullName} /> : "—"} />
              <Meta label="Added" value={formatDateTime(item.createdAt)} />
              <Meta label="Updated" value={formatDateTime(item.updatedAt)} />
              {item.archivedAt ? (
                <Meta label="Archived" value={formatDateTime(item.archivedAt)} />
              ) : null}
            </dl>
          </section>
        </div>
      </div>

      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="inventory_item" parentId={itemId} className="mt-4" />
    </ItemPageShell>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}
