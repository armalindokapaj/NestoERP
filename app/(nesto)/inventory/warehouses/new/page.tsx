import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WarehouseForm } from "@/components/inventory/warehouse-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createWarehouseAction } from "@/lib/actions/inventory";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";

export const metadata: Metadata = { title: "New warehouse" };

/** Add a warehouse (PRD #20 §50, §64). */
export default async function NewWarehousePage() {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.warehouse.create")) notFound();

  const options = await warehouses.warehouseFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory" },
          { label: "Warehouses", href: "/inventory/warehouses" },
          { label: "New warehouse" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New warehouse</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Somewhere stock is physically kept. It gets a GENERAL location automatically, so it can
          take stock straight away.
        </p>
      </div>

      <WarehouseForm
        action={createWarehouseAction}
        cancelHref="/inventory/warehouses"
        submitLabel="Add warehouse"
        pendingLabel="Adding…"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
      />
    </div>
  );
}
