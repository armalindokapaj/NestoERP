import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { WarehouseForm } from "@/components/inventory/warehouse-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateWarehouseAction } from "@/lib/actions/inventory";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";

type Params = { params: Promise<{ warehouseId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.editWarehouse") };
}

/** Edit a warehouse. An archived one is read-only until restored (PRD #20 §59). */
export default async function EditWarehousePage({ params }: Params) {
  const { warehouseId } = await params;
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");

  let warehouse;
  try {
    warehouse = await warehouses.getWarehouse(context, warehouseId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!warehouse.capabilities.canEdit) notFound();

  const options = await warehouses.warehouseFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateWarehouseAction(warehouseId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.warehouses"), href: "/inventory/warehouses" },
          { label: warehouse.name, href: `/inventory/warehouses/${warehouse.id}` },
          { label: t("actions.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.editWarehouse")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{warehouse.name}</p>
      </div>

      <WarehouseForm
        action={action}
        versionUpdatedAt={warehouse.updatedAt}
        cancelHref={`/inventory/warehouses/${warehouse.id}`}
        submitLabel={t("form.saveChanges")}
        pendingLabel={t("form.saving")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        values={{
          code: warehouse.code,
          name: warehouse.name,
          description: warehouse.description ?? "",
          warehouseType: warehouse.warehouseType,
          projectId: warehouse.project?.id ?? "",
          address: warehouse.address ?? "",
          city: warehouse.city ?? "",
          country: warehouse.country ?? "",
          status: warehouse.status,
        }}
      />
    </div>
  );
}
