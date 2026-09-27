import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { inventoryLabel } from "@/components/inventory/inventory-labels";

import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { LocationList } from "@/components/inventory/location-list";
import { requireModule } from "@/lib/context/current-user";
import * as warehouseService from "@/lib/modules/inventory/warehouses/warehouse.service";
import { warehouseTypeLabels } from "@/lib/modules/inventory/inventory.status";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { WarehousePageShell, loadWarehousePage } from "./warehouse-shell";

type Params = { params: Promise<{ warehouseId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { warehouseId } = await params;
  try {
    const context = await requireModule("inventory");
    const warehouse = await warehouseService.getWarehouse(context, warehouseId);
    return { title: warehouse.name };
  } catch {
    const t = await getTranslations("inventory");
    return { title: t("columns.warehouse") };
  }
}

/** Warehouse overview (PRD #20 §308). */
export default async function WarehousePage({ params }: Params) {
  const { warehouseId } = await params;
  const { warehouse } = await loadWarehousePage(warehouseId, "overview");
  const t = await getTranslations("inventory");

  return (
    <WarehousePageShell warehouse={warehouse} tab="overview">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("fields.code"), value: warehouse.code },
                { label: t("fields.type"), value: inventoryLabel(t, "warehouseType", warehouse.warehouseType, warehouseTypeLabels[warehouse.warehouseType]) },
                {
                  label: t("fields.project"),
                  value: warehouse.project
                    ? `${warehouse.project.code} — ${warehouse.project.name}`
                    : t("detail.noProject"),
                },
                { label: t("fields.address"), value: orDash(warehouse.address) },
                { label: t("fields.city"), value: orDash(warehouse.city) },
                { label: t("fields.country"), value: orDash(warehouse.country) },
              ]}
            />

            {warehouse.description ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-table font-semibold text-fg">{t("fields.description")}</h3>
                <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                  {warehouse.description}
                </p>
              </div>
            ) : null}
          </section>

          <LocationList
            warehouseId={warehouse.id}
            locations={warehouse.locations}
            canCreate={warehouse.capabilities.canManageLocations}
          />
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.holding")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("columns.locations")} value={String(warehouse.locationCount)} />
              <Meta label={t("detail.distinctItems")} value={String(warehouse.distinctItems)} />
            </dl>
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("detail.addedBy")} value={warehouse.createdBy ? <PersonLink memberId={warehouse.createdBy.memberId} name={warehouse.createdBy.fullName} /> : "—"} />
              <Meta label={t("detail.added")} value={formatDateTime(warehouse.createdAt)} />
              <Meta label={t("detail.updated")} value={formatDateTime(warehouse.updatedAt)} />
              {warehouse.archivedAt ? (
                <Meta label={t("labels.warehouseStatus.ARCHIVED")} value={formatDateTime(warehouse.archivedAt)} />
              ) : null}
            </dl>
          </section>
        </div>
      </div>
    </WarehousePageShell>
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
