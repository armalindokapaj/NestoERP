"use client";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ITEM_CATEGORIES,
  itemCategoryLabels,
} from "@/lib/modules/inventory/inventory.status";

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
  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Item"
        description="What the company stocks. One row here, however many warehouses hold it."
      >
        <Field label="SKU" name="sku" required hint="Unique across the company">
          <Input id="sku" name="sku" defaultValue={values?.sku ?? ""} required maxLength={60} />
        </Field>

        <Field label="Category" name="category" required>
          <select
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "MATERIAL"}
          >
            {ITEM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {itemCategoryLabels[category]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name" name="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={values?.name ?? ""} required maxLength={200} />
        </Field>

        <Field
          label="Base unit"
          name="baseUnit"
          required
          hint={
            baseUnitLocked
              ? "Locked: this item has already moved, and the ledger is recorded in this unit."
              : "How it is counted — bags, m3, tonne, each. It cannot change once stock has moved."
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

        <Field label="Status" name="status" required>
          <select
            id="status"
            name="status"
            className={selectClass}
            defaultValue={values?.status === "ARCHIVED" ? "INACTIVE" : (values?.status ?? "ACTIVE")}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>

        <Field label="Description" name="description" className="sm:col-span-2">
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
        title="Stock thresholds"
        description="Leave both blank and the item is never reported as low. NESTO does not invent a number the company never chose."
      >
        <Field
          label="Minimum stock"
          name="minimumStock"
          hint="The floor. Below this, the item reads as below minimum."
        >
          <Input
            id="minimumStock"
            name="minimumStock"
            defaultValue={values?.minimumStock ?? ""}
            inputMode="decimal"
          />
        </Field>

        <Field
          label="Reorder point"
          name="reorderPoint"
          hint="When to buy more. At or above the minimum."
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
        title="Defaults"
        description="Where this item usually goes, so stock documents open on the right row."
      >
        <Field label="Default warehouse" name="defaultWarehouseId">
          <select
            id="defaultWarehouseId"
            name="defaultWarehouseId"
            className={selectClass}
            defaultValue={values?.defaultWarehouseId ?? ""}
          >
            <option value="">Not set</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.value} value={warehouse.value}>
                {warehouse.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Default location" name="defaultLocationId">
          <select
            id="defaultLocationId"
            name="defaultLocationId"
            className={selectClass}
            defaultValue={values?.defaultLocationId ?? ""}
          >
            <option value="">Not set</option>
            {locations.map((location) => (
              <option key={location.value} value={location.value}>
                {location.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>
    </RecordForm>
  );
}
