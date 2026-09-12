import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ItemForm } from "@/components/inventory/item-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createItemAction } from "@/lib/actions/inventory";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";

export const metadata: Metadata = { title: "New item" };

/** Add an inventory item (PRD #20 §42, §43). */
export default async function NewItemPage() {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.item.create")) notFound();

  const [warehouseOptions, locationOptions] = await Promise.all([
    warehouses.selectableWarehouses(context),
    warehouses.selectableLocations(context),
  ]);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Items", href: "/inventory/items" },
          { label: "New item" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New item</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Something the company stocks. Choose the unit carefully — it cannot change once stock
          has moved.
        </p>
      </div>

      <ItemForm
        action={createItemAction}
        cancelHref="/inventory/items"
        submitLabel="Add item"
        pendingLabel="Adding…"
        warehouses={warehouseOptions}
        locations={locationOptions}
      />
    </div>
  );
}
