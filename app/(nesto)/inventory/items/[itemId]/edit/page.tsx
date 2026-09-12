import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ItemForm } from "@/components/inventory/item-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateItemAction } from "@/lib/actions/inventory";
import * as items from "@/lib/modules/inventory/items/item.service";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";

type Params = { params: Promise<{ itemId: string }> };

export const metadata: Metadata = { title: "Edit item" };

/** Edit an item. An archived one is read-only until restored (PRD #20 §45). */
export default async function EditItemPage({ params }: Params) {
  const { itemId } = await params;
  const context = await requireModule("inventory");

  let item;
  try {
    item = await items.getItem(context, itemId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!item.capabilities.canEdit) notFound();

  const [warehouseOptions, locationOptions, moved] = await Promise.all([
    warehouses.selectableWarehouses(context),
    warehouses.selectableLocations(context),
    items.hasMovements(itemId),
  ]);

  async function action(formData: FormData) {
    "use server";
    return updateItemAction(itemId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Items", href: "/inventory/items" },
          { label: item.name, href: `/inventory/items/${item.id}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit item</h1>
        <p className="mt-1.5 text-body text-fg-muted">{item.name}</p>
      </div>

      <ItemForm
        action={action}
        versionUpdatedAt={item.updatedAt}
        cancelHref={`/inventory/items/${item.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        warehouses={warehouseOptions}
        locations={locationOptions}
        baseUnitLocked={moved}
        values={{
          sku: item.sku,
          name: item.name,
          description: item.description ?? "",
          category: item.category,
          baseUnit: item.baseUnit,
          status: item.status,
          minimumStock: item.minimumStock ?? "",
          reorderPoint: item.reorderPoint ?? "",
          defaultWarehouseId: item.defaultWarehouse?.id ?? "",
          defaultLocationId: item.defaultLocation?.id ?? "",
        }}
      />
    </div>
  );
}
