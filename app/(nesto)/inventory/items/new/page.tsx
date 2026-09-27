import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { ItemForm } from "@/components/inventory/item-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createItemAction } from "@/lib/actions/inventory";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.newItem") };
}

/** Add an inventory item (PRD #20 §42, §43). */
export default async function NewItemPage() {
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");
  if (!can(context, "inventory.item.create")) notFound();

  const [warehouseOptions, locationOptions] = await Promise.all([
    warehouses.selectableWarehouses(context),
    warehouses.selectableLocations(context),
  ]);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("breadcrumbs.items"), href: "/inventory/items" },
          { label: t("meta.newItem") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newItem")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("newPage.items")}
        </p>
      </div>

      <ItemForm
        action={createItemAction}
        cancelHref="/inventory/items"
        submitLabel={t("form.addItem")}
        pendingLabel={t("form.adding")}
        warehouses={warehouseOptions}
        locations={locationOptions}
      />
    </div>
  );
}
