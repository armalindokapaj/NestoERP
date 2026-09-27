import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { WarehouseForm } from "@/components/inventory/warehouse-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createWarehouseAction } from "@/lib/actions/inventory";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.newWarehouse") };
}

/** Add a warehouse (PRD #20 §50, §64). */
export default async function NewWarehousePage() {
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");
  if (!can(context, "inventory.warehouse.create")) notFound();

  const options = await warehouses.warehouseFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.warehouses"), href: "/inventory/warehouses" },
          { label: t("meta.newWarehouse") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.newWarehouse")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("newPage.warehouses")}
        </p>
      </div>

      <WarehouseForm
        action={createWarehouseAction}
        cancelHref="/inventory/warehouses"
        submitLabel={t("form.addWarehouse")}
        pendingLabel={t("form.adding")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
      />
    </div>
  );
}
