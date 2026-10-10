import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { inventoryLabel } from "@/components/inventory/inventory-labels";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { StockTable } from "@/components/inventory/stock-table";
import { formatQuantity } from "@/components/inventory/inventory-format";
import { requireModule } from "@/lib/context/current-user";
import * as itemService from "@/lib/modules/inventory/items/item.service";
import { itemCategoryLabels } from "@/lib/modules/inventory/inventory.status";
import { formatDateTime } from "@/lib/utils/format";
import { loadItemPage } from "../item-shell";

type Params = { params: Promise<{ itemId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { itemId } = await params;
  try {
    const context = await requireModule("inventory");
    const item = await itemService.getItem(context, itemId);
    return { title: item.name };
  } catch {
    const t = await getTranslations("inventory");
    return { title: t("meta.inventoryItem") };
  }
}

/** Item overview (PRD #20 §306). */
export default async function ItemPage({ params }: Params) {
  const { itemId } = await params;
  const { item } = await loadItemPage(itemId, "overview");
  const t = await getTranslations("inventory");

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("fields.sku"), value: item.sku },
                { label: t("fields.category"), value: inventoryLabel(t, "itemCategory", item.category, itemCategoryLabels[item.category]) },
                { label: t("fields.baseUnit"), value: item.baseUnit },
                {
                  label: t("fields.minimumStock"),
                  value:
                    item.minimumStock === null
                      ? t("fields.notSet")
                      : `${formatQuantity(item.minimumStock)} ${item.baseUnit}`,
                },
                {
                  label: t("fields.reorderPoint"),
                  value:
                    item.reorderPoint === null
                      ? t("fields.notSet")
                      : `${formatQuantity(item.reorderPoint)} ${item.baseUnit}`,
                },
                {
                  label: t("fields.defaultWarehouse"),
                  value: item.defaultWarehouse
                    ? `${item.defaultWarehouse.code} — ${item.defaultWarehouse.name}`
                    : t("fields.notSet"),
                },
                {
                  label: t("fields.defaultLocation"),
                  value: item.defaultLocation ? item.defaultLocation.code : t("fields.notSet"),
                },
              ]}
            />

            {item.description ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">{t("fields.description")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {item.description}
                </p>
              </div>
            ) : null}
          </section>

          {item.capabilities.canViewStock ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("warehouseForm.whereItIs")}</h2>
              {item.byLocation.length === 0 ? (
                <p className="nesto-card p-5 text-table text-fg-subtle">
                  {t("detail.itemNowhere")}
                </p>
              ) : (
                <StockTable
                  rows={item.byLocation}
                  show="by-item"
                  caption={t("detail.byLocation", { name: item.name })}
                  listId="inventory.item-stock"
                />
              )}
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("detail.addedBy")} value={item.createdBy ? <PersonLink memberId={item.createdBy.memberId} name={item.createdBy.fullName} /> : "—"} />
              <Meta label={t("detail.added")} value={formatDateTime(item.createdAt)} />
              <Meta label={t("detail.updated")} value={formatDateTime(item.updatedAt)} />
              {item.archivedAt ? (
                <Meta label={t("labels.itemStatus.ARCHIVED")} value={formatDateTime(item.archivedAt)} />
              ) : null}
            </dl>
          </section>
        </div>
      </div>

      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="inventory_item" parentId={itemId} className="mt-4" />
    </>
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
