"use client";

import * as React from "react";

import { withSavedOption } from "@/components/finance/saved-option";
import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ITEM_CATEGORIES, itemCategoryLabels } from "@/lib/modules/inventory/inventory.status";
import { inventoryLabel, useInventoryTranslations } from "./inventory-text";
import { FormSelect } from "@/components/ui/form-select";

export type ItemFormValues = {
  sku: string;
  name: string;
  description: string;
  category: string;
  baseUnit: string;
  status: string;
  minimumStock: string;
  reorderPoint: string;
  defaultWarehouseId: string;
  defaultLocationId: string;
};

/**
 * Create and edit an inventory item (PRD #20 §42–§46).
 *
 * The base unit is locked once the item has moved. Changing "bags" to "tonnes"
 * under a ledger already recorded in bags would silently rewrite history, so
 * the field is disabled rather than validated after the fact (PRD #20 §46).
 *
 * The archive is not a status here: archiving has its own rule — stock on hand
 * blocks it — and a dropdown would make it look like an ordinary edit (§47).
 */
export function ItemForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  warehouses,
  locations,
  baseUnitLocked = false,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: ItemFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  warehouses: { value: string; label: string }[];
  locations: { value: string; label: string; warehouseId: string }[];
  baseUnitLocked?: boolean;
}) {
  // The default location follows the default warehouse (AUD-09 §5, FV-08): only
  // that warehouse's locations are offered, and choosing another warehouse
  // clears a location it does not hold, saying so. A saved default the pickers
  // no longer offer (an inactive warehouse or location) stays on this item
  // until it is changed deliberately (FV-10).
  const t = useInventoryTranslations();
  const [warehouseId, setWarehouseId] = React.useState(values?.defaultWarehouseId ?? "");
  const [locationId, setLocationId] = React.useState(values?.defaultLocationId ?? "");
  const [locationNote, setLocationNote] = React.useState<string | null>(null);
  const warehouseOptions = withSavedOption(warehouses, values?.defaultWarehouseId, t("itemForm.savedWarehouse"));
  const locationOptions = withSavedOption(
    locations.filter((location) => location.warehouseId === warehouseId),
    values?.defaultWarehouseId === warehouseId ? values?.defaultLocationId : undefined,
    t("itemForm.savedLocation"),
    { warehouseId },
  );

  function chooseWarehouse(next: string) {
    setWarehouseId(next);
    if (locationId && !locations.some((location) => location.value === locationId && location.warehouseId === next) && !(next === values?.defaultWarehouseId && locationId === values?.defaultLocationId)) {
      setLocationId("");
      setLocationNote(t("itemForm.locationCleared"));
    } else {
      setLocationNote(null);
    }
  }

  return (
    <RecordForm
      action={action}
      module="inventory"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title={t("itemForm.section")}
        description={t("itemForm.sectionDescription")}
      >
        <Field label={t("fields.sku")} name="sku" required hint={t("fields.uniqueHint")}>
          <Input id="sku" name="sku" defaultValue={values?.sku ?? ""} required maxLength={60} />
        </Field>

        <Field label={t("fields.category")} name="category" required>
          <FormSelect
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "MATERIAL"}
          >
            {ITEM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {inventoryLabel(t, "itemCategory", category, itemCategoryLabels[category])}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("fields.name")} name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field
          label={t("fields.baseUnit")}
          name="baseUnit"
          required
          hint={
            baseUnitLocked
              ? t("itemForm.baseUnitLocked")
              : t("itemForm.baseUnitHint")
          }
        >
          <Input
            id="baseUnit"
            name="baseUnit"
            defaultValue={values?.baseUnit ?? "each"}
            required
            maxLength={24}
            readOnly={baseUnitLocked}
            aria-readonly={baseUnitLocked || undefined}
            className={baseUnitLocked ? "bg-surface-muted text-fg-muted" : undefined}
          />
        </Field>

        <Field label={t("fields.status")} name="status" required>
          <FormSelect
            id="status"
            name="status"
            className={selectClass}
            defaultValue={values?.status === "ARCHIVED" ? "INACTIVE" : (values?.status ?? "ACTIVE")}
          >
            <option value="ACTIVE">{t("labels.itemStatus.ACTIVE")}</option>
            <option value="INACTIVE">{t("labels.itemStatus.INACTIVE")}</option>
          </FormSelect>
        </Field>

        <Field label={t("fields.description")} name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={values?.description ?? ""}
            maxLength={2000}
          />
        </Field>
      </FormSection>

      <FormSection
        title={t("itemForm.thresholds")}
        description={t("itemForm.thresholdsDescription")}
      >
        <Field
          label={t("fields.minimumStock")}
          name="minimumStock"
          hint={t("itemForm.minimumHint")}
        >
          <Input
            id="minimumStock"
            name="minimumStock"
            defaultValue={values?.minimumStock ?? ""}
            inputMode="decimal"
          />
        </Field>

        <Field
          label={t("fields.reorderPoint")}
          name="reorderPoint"
          hint={t("itemForm.reorderHint")}
        >
          <Input
            id="reorderPoint"
            name="reorderPoint"
            defaultValue={values?.reorderPoint ?? ""}
            inputMode="decimal"
          />
        </Field>
      </FormSection>

      <FormSection
        title={t("itemForm.defaults")}
        description={t("itemForm.defaultsDescription")}
      >
        <Field label={t("fields.defaultWarehouse")} name="defaultWarehouseId">
          <FormSelect
            id="defaultWarehouseId"
            name="defaultWarehouseId"
            className={selectClass}
            value={warehouseId}
            onChange={(event) => chooseWarehouse(event.target.value)}
          >
            <option value="">{t("fields.notSet")}</option>
            {warehouseOptions.map((warehouse) => (
              <option key={warehouse.value} value={warehouse.value}>
                {warehouse.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("fields.defaultLocation")} name="defaultLocationId" hint={locationNote ?? (warehouseId ? undefined : t("itemForm.chooseWarehouseFirst"))}>
          <FormSelect
            id="defaultLocationId"
            name="defaultLocationId"
            className={selectClass}
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setLocationNote(null);
            }}
            disabled={!warehouseId}
          >
            <option value="">{warehouseId && locationOptions.length === 0 ? t("lines.noLocations") : t("fields.notSet")}</option>
            {locationOptions.map((location) => (
              <option key={location.value} value={location.value}>
                {location.label}
              </option>
            ))}
          </FormSelect>
        </Field>
      </FormSection>
    </RecordForm>
  );
}
